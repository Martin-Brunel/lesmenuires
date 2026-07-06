"use client";

import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Redo2,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePrompt } from "@/components/admin/dialogs";

export function RichTextEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (html: string) => void;
}) {
  const promptDialog = usePrompt();
  const editor = useEditor({
    immediatelyRender: false, // avoid SSR hydration mismatch in Next
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: { openOnClick: false },
      }),
    ],
    content: value || "",
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: { class: "tiptap min-h-[160px] px-3 py-2.5 focus:outline-none" },
    },
  });

  // Resynchronise l'éditeur quand `value` change de l'extérieur (ex. HTML
  // re-sanitisé renvoyé par le serveur après sauvegarde) — jamais pendant la
  // frappe : les updates internes passent par onUpdate et laissent value ===
  // getHTML(), et on ne touche pas à un éditeur focalisé.
  useEffect(() => {
    if (editor && !editor.isFocused && editor.getHTML() !== (value || "<p></p>")) {
      editor.commands.setContent(value || "");
    }
  }, [editor, value]);

  if (!editor) return null;

  const setLink = async () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = await promptDialog({
      title: "Insérer un lien",
      label: "URL (laisser vide pour retirer le lien)",
      defaultValue: prev ?? "https://",
      confirmLabel: "Appliquer",
    });
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="rounded-md border border-input bg-background">
      <div className="flex flex-wrap items-center gap-1 border-b p-1.5">
        <Tool label="Gras" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="size-4" />
        </Tool>
        <Tool label="Italique" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="size-4" />
        </Tool>
        <Divider />
        <Tool label="Titre" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 className="size-4" />
        </Tool>
        <Tool label="Sous-titre" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          <Heading3 className="size-4" />
        </Tool>
        <Tool label="Liste à puces" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="size-4" />
        </Tool>
        <Tool label="Liste numérotée" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="size-4" />
        </Tool>
        <Tool label="Lien" active={editor.isActive("link")} onClick={setLink}>
          <Link2 className="size-4" />
        </Tool>
        <Divider />
        <Tool label="Annuler" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 className="size-4" />
        </Tool>
        <Tool label="Rétablir" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 className="size-4" />
        </Tool>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

function Tool({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors disabled:opacity-40",
        active ? "bg-primary text-primary-foreground" : "hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="w-px h-5 bg-border mx-1" />;
}
