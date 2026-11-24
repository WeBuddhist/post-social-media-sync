import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** A brand of the dashboard: its id is the owner id its accounts, media and posts belong to. */
export interface Brand {
  id: string;
  name: string;
  /** Epoch milliseconds. */
  createdAt: number;
}

const FILE = "brands.json";
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_NAME = 60;
/** The brand the dashboard starts with: everything connected before brands existed belongs to owner "default". */
const FIRST_BRAND = { id: "default", name: "My brand" };

const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

function checkName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name || [...name].length > MAX_NAME) throw fail(400, `Give the brand a name of 1-${MAX_NAME} characters.`);
  if (/\p{Cc}/u.test(name)) throw fail(400, "Brand names can't contain control characters.");
  return name;
}

/** "Café Ünïcorn.ai" → "cafe-unicorn-ai". */
function slug(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
  return base || "brand";
}

/** The dashboard's brands in DATA_DIR/brands.json, read on every call so replicas sharing DATA_DIR agree. */
export class Brands {
  readonly file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, FILE);
  }

  /** Every brand, oldest first. Creates the file with the first brand ("default") if it doesn't exist. */
  list(): Brand[] {
    let raw: string;
    try {
      raw = fs.readFileSync(this.file, "utf8");
    } catch (err: any) {
      if (err?.code !== "ENOENT") throw err;
      return this.write([{ ...FIRST_BRAND, createdAt: Date.now() }]);
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`${this.file} is not valid JSON. Fix or delete it.`);
    }
    const brands = (Array.isArray(data) ? data : [])
      .filter((b) => b && typeof b.id === "string" && ID.test(b.id) && typeof b.name === "string")
      .map((b): Brand => ({ id: b.id, name: b.name, createdAt: Number(b.createdAt) || 0 }));
    return brands.length ? brands : this.write([{ ...FIRST_BRAND, createdAt: Date.now() }]);
  }

  get(id: string): Brand | undefined {
    return this.list().find((b) => b.id === id);
  }

  create(rawName: unknown): Brand {
    const name = checkName(rawName);
    const brands = this.list();
    this.checkUnique(brands, name);
    const taken = new Set(brands.map((b) => b.id.toLowerCase()));
    const base = slug(name);
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    const brand = { id, name, createdAt: Date.now() };
    this.write([...brands, brand]);
    return brand;
  }

  rename(id: string, rawName: unknown): Brand {
    const name = checkName(rawName);
    const brands = this.list();
    const brand = brands.find((b) => b.id === id);
    if (!brand) throw fail(404, "Brand not found.");
    this.checkUnique(brands.filter((b) => b !== brand), name);
    brand.name = name;
    this.write(brands);
    return brand;
  }

  /** Removes a brand (the caller checks it has no accounts or posts). The last brand can't be removed. */
  remove(id: string): void {
    const brands = this.list();
    if (!brands.some((b) => b.id === id)) throw fail(404, "Brand not found.");
    if (brands.length === 1) throw fail(409, "You can't delete the only brand. Rename it instead.");
    this.write(brands.filter((b) => b.id !== id));
  }

  private checkUnique(others: Brand[], name: string): void {
    const lower = name.toLowerCase();
    if (others.some((b) => b.name.toLowerCase() === lower)) throw fail(409, `There is already a brand called "${name}".`);
  }

  /** Atomic: a reader (or another replica) sees the old file or the new one, never half of one. */
  private write(brands: Brand[]): Brand[] {
    const tmp = `${this.file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}`;
    fs.writeFileSync(tmp, `${JSON.stringify(brands, null, 2)}\n`);
    fs.renameSync(tmp, this.file);
    return brands;
  }
}
