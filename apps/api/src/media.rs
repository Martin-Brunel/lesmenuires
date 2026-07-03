//! Variantes d'images : à l'upload (et en backfill au démarrage), chaque photo
//! est déclinée en versions redimensionnées `<stem>-w<width>.jpg` à côté de
//! l'original, et `property_media.widths` mémorise les largeurs générées. Le
//! front choisit alors la taille adaptée au contexte (vignette, héro, plein
//! écran) au lieu de charger l'original en pleine résolution.

use sqlx::PgPool;
use std::path::{Path, PathBuf};

/// Largeurs générées (px). On ne suréchantillonne jamais : une largeur n'est
/// produite que si l'original est strictement plus large.
pub const VARIANT_WIDTHS: [u32; 3] = [480, 960, 1600];

/// Qualité JPEG des variantes (photos d'annonce : 82 = net et léger).
const JPEG_QUALITY: u8 = 82;

/// "abc123.jpg" + 960 → "abc123-w960.jpg"
pub fn variant_filename(original: &str, width: u32) -> String {
    let stem = original
        .rsplit_once('.')
        .map(|(s, _)| s)
        .unwrap_or(original);
    format!("{stem}-w{width}.jpg")
}

/// Décode, redimensionne et écrit les variantes d'un fichier déjà présent dans
/// `media_dir`. Retourne les largeurs générées (triées). Erreur = original
/// illisible (pas une image) ; une variante individuelle qui échoue est ignorée.
pub async fn generate_variants(media_dir: &Path, filename: &str) -> anyhow::Result<Vec<i32>> {
    let dir: PathBuf = media_dir.to_path_buf();
    let name = filename.to_string();
    // Décodage + Lanczos3 = CPU-bound : hors de l'executor async.
    tokio::task::spawn_blocking(move || -> anyhow::Result<Vec<i32>> {
        let img = image::open(dir.join(&name))?;
        let (w, _) = (img.width(), img.height());
        let mut widths = vec![];
        for target in VARIANT_WIDTHS {
            if w <= target {
                continue;
            }
            let resized = img.resize(target, u32::MAX, image::imageops::FilterType::Lanczos3);
            let out = dir.join(variant_filename(&name, target));
            let file = match std::fs::File::create(&out) {
                Ok(f) => f,
                Err(e) => {
                    tracing::warn!("media: création {out:?} impossible: {e}");
                    continue;
                }
            };
            let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(
                std::io::BufWriter::new(file),
                JPEG_QUALITY,
            );
            // Le JPEG ne connaît pas l'alpha (PNG/WebP transparents) → RGB8.
            match enc.encode_image(&resized.to_rgb8()) {
                Ok(()) => widths.push(target as i32),
                Err(e) => {
                    tracing::warn!("media: encodage {out:?} échoué: {e}");
                    let _ = std::fs::remove_file(&out);
                }
            }
        }
        Ok(widths)
    })
    .await?
}

/// Supprime les variantes associées à un original (après delete du média).
pub async fn remove_variants(media_dir: &Path, filename: &str, widths: &[i32]) {
    for w in widths.iter().filter(|w| **w > 0) {
        let _ = tokio::fs::remove_file(media_dir.join(variant_filename(filename, *w as u32))).await;
    }
}

/// Backfill au démarrage : génère les variantes des médias uploadés avant
/// cette fonctionnalité (widths = '{}'). Idempotent, en tâche de fond — un
/// échec sur un fichier (disparu, corrompu) est journalisé et marqué pour ne
/// pas être retenté à chaque boot.
pub fn spawn_backfill(pool: PgPool, media_dir: std::sync::Arc<PathBuf>) {
    tokio::spawn(async move {
        let rows: Vec<(uuid::Uuid, String)> = match sqlx::query_as(
            "select id, filename from property_media where widths = '{}' order by created_at",
        )
        .fetch_all(&pool)
        .await
        {
            Ok(r) => r,
            Err(e) => {
                tracing::error!("media backfill: lecture impossible: {e:?}");
                return;
            }
        };
        if rows.is_empty() {
            return;
        }
        tracing::info!(
            "media: génération des variantes pour {} photo(s)…",
            rows.len()
        );
        for (id, filename) in rows {
            let widths = match generate_variants(&media_dir, &filename).await {
                Ok(w) => w,
                Err(e) => {
                    // {-1} = sentinelle « original illisible, ne pas retenter ».
                    tracing::warn!("media backfill: {filename}: {e}");
                    vec![-1]
                }
            };
            if let Err(e) = sqlx::query("update property_media set widths = $2 where id = $1")
                .bind(id)
                .bind(&widths)
                .execute(&pool)
                .await
            {
                tracing::error!("media backfill: update {filename}: {e:?}");
            }
        }
        tracing::info!("media: backfill des variantes terminé");
    });
}
