export type AmenityIcon =
  | "wifi"
  | "car"
  | "garage"
  | "evCharger"
  | "kitchen"
  | "dishwasher"
  | "oven"
  | "microwave"
  | "fridge"
  | "washer"
  | "dryer"
  | "iron"
  | "tv"
  | "snowflake"
  | "heating"
  | "fireplace"
  | "bath"
  | "shower"
  | "bed"
  | "mountain"
  | "balcony"
  | "terrace"
  | "garden"
  | "pool"
  | "hotTub"
  | "sauna"
  | "baby"
  | "chair"
  | "pet"
  | "coffee"
  | "workspace"
  | "key"
  | "ski"
  | "boot"
  | "locker"
  | "elevator"
  | "accessible"
  | "smokeAlarm"
  | "firstAid"
  | "extinguisher"
  | "home";

export type Amenity = {
  icon: AmenityIcon;
  label: string;
  labelEn?: string;
};

export const AMENITY_ICON_OPTIONS: { value: AmenityIcon; label: string }[] = [
  { value: "wifi", label: "Wifi" },
  { value: "car", label: "Parking" },
  { value: "garage", label: "Garage" },
  { value: "evCharger", label: "Borne de recharge électrique" },
  { value: "kitchen", label: "Cuisine" },
  { value: "dishwasher", label: "Lave-vaisselle" },
  { value: "oven", label: "Four" },
  { value: "microwave", label: "Micro-ondes" },
  { value: "fridge", label: "Réfrigérateur" },
  { value: "washer", label: "Lave-linge" },
  { value: "dryer", label: "Sèche-linge" },
  { value: "iron", label: "Fer à repasser" },
  { value: "tv", label: "Télévision" },
  { value: "snowflake", label: "Climatisation" },
  { value: "heating", label: "Chauffage" },
  { value: "fireplace", label: "Cheminée" },
  { value: "bath", label: "Salle de bain" },
  { value: "shower", label: "Douche" },
  { value: "bed", label: "Literie" },
  { value: "mountain", label: "Vue montagne" },
  { value: "balcony", label: "Balcon" },
  { value: "terrace", label: "Terrasse" },
  { value: "garden", label: "Jardin" },
  { value: "pool", label: "Piscine" },
  { value: "hotTub", label: "Bain à remous" },
  { value: "sauna", label: "Sauna" },
  { value: "baby", label: "Équipement bébé" },
  { value: "chair", label: "Chaise haute" },
  { value: "pet", label: "Animaux" },
  { value: "coffee", label: "Café" },
  { value: "workspace", label: "Espace de travail" },
  { value: "key", label: "Arrivée autonome" },
  { value: "ski", label: "Ski / remontées" },
  { value: "boot", label: "Chaussures / local ski" },
  { value: "locker", label: "Casier de rangement" },
  { value: "elevator", label: "Ascenseur" },
  { value: "accessible", label: "Accessibilité" },
  { value: "smokeAlarm", label: "Détecteur de fumée" },
  { value: "firstAid", label: "Trousse de secours" },
  { value: "extinguisher", label: "Extincteur" },
  { value: "home", label: "Logement entier" },
];
