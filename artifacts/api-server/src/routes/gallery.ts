import { Router, type IRouter } from "express";
import {
  GetStorefrontGalleryResponse,
  GetAdminGalleryResponse,
  AddGalleryImageBody,
  AddGalleryImageResponse,
  UpdateGalleryImageBody,
  UpdateGalleryImageParams,
  UpdateGalleryImageResponse,
  DeleteGalleryImageParams,
  DeleteGalleryImageResponse,
  ReorderGalleryBody,
  ReorderGalleryResponse,
} from "@workspace/api-zod";
import { requireStaff, type StaffRequest } from "../middlewares/requireStaff";
import {
  listPublicGallery,
  listAllGallery,
  addGalleryImage,
  updateGalleryImage,
  deleteGalleryImage,
  reorderGallery,
} from "../lib/gallery";

const router: IRouter = Router();

/** Public: active gallery images for the storefront. */
router.get("/storefront/gallery", async (req, res) => {
  try {
    const images = await listPublicGallery();
    return res.json(GetStorefrontGalleryResponse.parse(images));
  } catch (err) {
    req.log.error({ err }, "Failed to load storefront gallery");
    return res.status(500).json({ error: "Could not load the gallery." });
  }
});

router.get("/admin/gallery", requireStaff, async (req, res) => {
  try {
    const images = await listAllGallery();
    return res.json(GetAdminGalleryResponse.parse(images));
  } catch (err) {
    req.log.error({ err }, "Failed to load admin gallery");
    return res.status(500).json({ error: "Could not load the gallery." });
  }
});

router.post("/admin/gallery", requireStaff, async (req, res) => {
  const parsed = AddGalleryImageBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request." });
  }
  // Only accept normalized object-entity paths produced by our upload flow.
  if (!parsed.data.object_path.startsWith("/objects/")) {
    return res.status(400).json({ error: "Invalid object path." });
  }
  try {
    const { userEmail } = req as StaffRequest;
    const image = await addGalleryImage({
      objectPath: parsed.data.object_path,
      alt: parsed.data.alt,
      owner: userEmail,
    });
    return res.json(AddGalleryImageResponse.parse(image));
  } catch (err) {
    req.log.error({ err }, "Failed to add gallery image");
    return res.status(500).json({ error: "Could not add the image." });
  }
});

// Registered before the :imageId routes for clarity (distinct method/path).
router.post("/admin/gallery/reorder", requireStaff, async (req, res) => {
  const parsed = ReorderGalleryBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request." });
  }
  try {
    const images = await reorderGallery(parsed.data.ids);
    return res.json(ReorderGalleryResponse.parse(images));
  } catch (err) {
    req.log.error({ err }, "Failed to reorder gallery");
    return res.status(500).json({ error: "Could not reorder the gallery." });
  }
});

router.patch("/admin/gallery/:imageId", requireStaff, async (req, res) => {
  const { imageId } = UpdateGalleryImageParams.parse(req.params);
  const parsed = UpdateGalleryImageBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request." });
  }
  try {
    const image = await updateGalleryImage(imageId, {
      alt: parsed.data.alt,
      active: parsed.data.active,
    });
    if (!image) {
      return res.status(404).json({ error: "Image not found." });
    }
    return res.json(UpdateGalleryImageResponse.parse(image));
  } catch (err) {
    req.log.error({ err }, "Failed to update gallery image");
    return res.status(500).json({ error: "Could not update the image." });
  }
});

router.delete("/admin/gallery/:imageId", requireStaff, async (req, res) => {
  const { imageId } = DeleteGalleryImageParams.parse(req.params);
  try {
    const ok = await deleteGalleryImage(imageId);
    if (!ok) {
      return res.status(404).json({ error: "Image not found." });
    }
    return res.json(DeleteGalleryImageResponse.parse({ ok: true }));
  } catch (err) {
    req.log.error({ err }, "Failed to delete gallery image");
    return res.status(500).json({ error: "Could not delete the image." });
  }
});

export default router;
