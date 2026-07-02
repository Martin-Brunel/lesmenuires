// Pays : stockés en code ISO 3166-1 alpha-2, affichés en français via
// Intl.DisplayNames (pas de liste de noms à maintenir).

const CODES = [
  "AD","AE","AF","AG","AI","AL","AM","AO","AQ","AR","AS","AT","AU","AW","AX","AZ",
  "BA","BB","BD","BE","BF","BG","BH","BI","BJ","BL","BM","BN","BO","BQ","BR","BS",
  "BT","BV","BW","BY","BZ","CA","CC","CD","CF","CG","CH","CI","CK","CL","CM","CN",
  "CO","CR","CU","CV","CW","CX","CY","CZ","DE","DJ","DK","DM","DO","DZ","EC","EE",
  "EG","EH","ER","ES","ET","FI","FJ","FK","FM","FO","FR","GA","GB","GD","GE","GF",
  "GG","GH","GI","GL","GM","GN","GP","GQ","GR","GS","GT","GU","GW","GY","HK","HM",
  "HN","HR","HT","HU","ID","IE","IL","IM","IN","IO","IQ","IR","IS","IT","JE","JM",
  "JO","JP","KE","KG","KH","KI","KM","KN","KP","KR","KW","KY","KZ","LA","LB","LC",
  "LI","LK","LR","LS","LT","LU","LV","LY","MA","MC","MD","ME","MF","MG","MH","MK",
  "ML","MM","MN","MO","MP","MQ","MR","MS","MT","MU","MV","MW","MX","MY","MZ","NA",
  "NC","NE","NF","NG","NI","NL","NO","NP","NR","NU","NZ","OM","PA","PE","PF","PG",
  "PH","PK","PL","PM","PN","PR","PS","PT","PW","PY","QA","RE","RO","RS","RU","RW",
  "SA","SB","SC","SD","SE","SG","SH","SI","SJ","SK","SL","SM","SN","SO","SR","SS",
  "ST","SV","SX","SY","SZ","TC","TD","TF","TG","TH","TJ","TK","TL","TM","TN","TO",
  "TR","TT","TV","TW","TZ","UA","UG","UM","US","UY","UZ","VA","VC","VE","VG","VI",
  "VN","VU","WF","WS","YE","YT","ZA","ZM","ZW",
];

const display = new Intl.DisplayNames(["fr"], { type: "region" });

export type Country = { code: string; name: string };

export const COUNTRIES: Country[] = CODES.map((code) => ({
  code,
  name: display.of(code) ?? code,
})).sort((a, b) => a.name.localeCompare(b.name, "fr"));

/** Code ISO → nom français ("FR" → "France"). Rend le code inconnu tel quel. */
export function countryName(code: string): string {
  const c = code.trim().toUpperCase();
  if (!c) return "";
  return (c.length === 2 ? display.of(c) : undefined) ?? code;
}

/** Nom (ou code) saisi → code ISO, null si non reconnu. */
export function countryCode(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  if (/^[a-zA-Z]{2}$/.test(v) && CODES.includes(v.toUpperCase())) return v.toUpperCase();
  const lower = v.toLowerCase();
  return COUNTRIES.find((c) => c.name.toLowerCase() === lower)?.code ?? null;
}
