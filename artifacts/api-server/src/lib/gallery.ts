import { asc, eq } from "drizzle-orm";
import { db, storeGalleryImages, type StoreGalleryImage } from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";

const objectStorage = new ObjectStorageService();

const iso = (d: Date | null | undefined): string =>
  d ? new Date(d).toISOString() : new Date(0).toISOString();

export interface GalleryImageDto {
  id: string;
  object_path: string;
  url: string;
  alt: string;
  sort_order: number;
  active: boolean;
  created_at: string;
}

/**
 * Serving URL for an uploaded object. `objectPath` is already normalized to
 * `/objects/...`; the storage router serves it under `/api/storage`.
 */
function servingUrl(objectPath: string): string {
  return `/api/storage${objectPath}`;
}

function toDto(row: StoreGalleryImage): GalleryImageDto {
  return {
    id: row.id,
    object_path: row.objectPath,
    url: servingUrl(row.objectPath),
    alt: row.alt,
    sort_order: row.sortOrder,
    active: row.active,
    created_at: iso(row.createdAt),
  };
}

/** Active images for the public storefront, in display order. */
export async function listPublicGallery(): Promise<GalleryImageDto[]> {
  const rows = await db
    .select()
    .from(storeGalleryImages)
    .where(eq(storeGalleryImages.active, true))
    .orderBy(
      asc(storeGalleryImages.sortOrder),
      asc(storeGalleryImages.createdAt),
    );
  return rows.map(toDto);
}

/** Every image (active and hidden) for the admin manager, in display order. */
export async function listAllGallery(): Promise<GalleryImageDto[]> {
  const rows = await db
    .select()
    .from(storeGalleryImages)
    .orderBy(
      asc(storeGalleryImages.sortOrder),
      asc(storeGalleryImages.createdAt),
    );
  return rows.map(toDto);
}

/**
 * Registers an already-uploaded object as a gallery image. Marks the object
 * publicly readable and appends it to the end of the current order.
 */
export async function addGalleryImage(input: {
  objectPath: string;
  alt?: string;
  owner: string;
}): Promise<GalleryImageDto> {
  const normalized = await objectStorage.trySetObjectEntityAclPolicy(
    input.objectPath,
    { owner: input.owner, visibility: "public" },
  );

  const existing = await db
    .select({ s: storeGalleryImages.sortOrder })
    .from(storeGalleryImages);
  const nextOrder =
    existing.reduce((max, r) => Math.max(max, r.s), -1) + 1;

  const [row] = await db
    .insert(storeGalleryImages)
    .values({
      objectPath: normalized,
      alt: input.alt ?? "",
      sortOrder: nextOrder,
    })
    .returning();
  return toDto(row);
}

export async function updateGalleryImage(
  id: string,
  patch: { alt?: string; active?: boolean },
): Promise<GalleryImageDto | null> {
  const fields: Partial<{ alt: string; active: boolean }> = {};
  if (patch.alt !== undefined) fields.alt = patch.alt;
  if (patch.active !== undefined) fields.active = patch.active;

  if (Object.keys(fields).length === 0) {
    const [row] = await db
      .select()
      .from(storeGalleryImages)
      .where(eq(storeGalleryImages.id, id));
    return row ? toDto(row) : null;
  }

  const [row] = await db
    .update(storeGalleryImages)
    .set(fields)
    .where(eq(storeGalleryImages.id, id))
    .returning();
  return row ? toDto(row) : null;
}

export async function deleteGalleryImage(id: string): Promise<boolean> {
  const [row] = await db
    .delete(storeGalleryImages)
    .where(eq(storeGalleryImages.id, id))
    .returning();
  if (!row) return false;

  // Best-effort removal of the underlying object; an orphaned object is
  // harmless and should not fail the request.
  try {
    const file = await objectStorage.getObjectEntityFile(row.objectPath);
    await file.delete();
  } catch {
    // ignore
  }
  return true;
}

/** Sets sort order to match the given id sequence; returns the new ordering. */
export async function reorderGallery(
  ids: string[],
): Promise<GalleryImageDto[]> {
  await Promise.all(
    ids.map((id, index) =>
      db
        .update(storeGalleryImages)
        .set({ sortOrder: index })
        .where(eq(storeGalleryImages.id, id)),
    ),
  );
  return listAllGallery();
}
