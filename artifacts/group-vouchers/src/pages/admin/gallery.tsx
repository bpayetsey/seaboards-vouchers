import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAdminGallery,
  useRequestUploadUrl,
  useAddGalleryImage,
  useUpdateGalleryImage,
  useDeleteGalleryImage,
  useReorderGallery,
  getGetAdminGalleryQueryKey,
  getGetStorefrontGalleryQueryKey,
} from "@workspace/api-client-react";
import type { GalleryImage } from "@workspace/api-client-react";
import { AdminShell } from "./AdminShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  Trash2,
  ArrowUp,
  ArrowDown,
  ImageOff,
  Loader2,
} from "lucide-react";

const MAX_BYTES = 10 * 1024 * 1024;

function ImageCard({
  image,
  index,
  total,
  onMove,
}: {
  image: GalleryImage;
  index: number;
  total: number;
  onMove: (from: number, to: number) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [alt, setAlt] = useState(image.alt);
  const update = useUpdateGalleryImage();
  const remove = useDeleteGalleryImage();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetAdminGalleryQueryKey() });
    queryClient.invalidateQueries({
      queryKey: getGetStorefrontGalleryQueryKey(),
    });
  };

  const saveAlt = () => {
    if (alt === image.alt) return;
    update.mutate(
      { imageId: image.id, data: { alt } },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Caption saved" });
        },
        onError: () =>
          toast({ title: "Could not save caption", variant: "destructive" }),
      },
    );
  };

  const toggleActive = (active: boolean) => {
    update.mutate(
      { imageId: image.id, data: { active } },
      {
        onSuccess: invalidate,
        onError: () =>
          toast({ title: "Could not update visibility", variant: "destructive" }),
      },
    );
  };

  const doDelete = () => {
    remove.mutate(
      { imageId: image.id },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Image removed" });
        },
        onError: () =>
          toast({ title: "Could not remove image", variant: "destructive" }),
      },
    );
  };

  return (
    <Card className="border-border/70 overflow-hidden">
      <div className="relative aspect-[4/3] bg-muted">
        <img
          src={image.url}
          alt={image.alt}
          className={`h-full w-full object-cover ${
            image.active ? "" : "opacity-40"
          }`}
        />
        {!image.active ? (
          <span className="absolute left-2 top-2 rounded-md bg-foreground/80 px-2 py-0.5 text-[11px] font-medium text-background">
            Hidden
          </span>
        ) : null}
      </div>
      <CardContent className="space-y-3 p-4">
        <div className="space-y-1.5">
          <label
            htmlFor={`alt-${image.id}`}
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
          >
            Caption (alt text)
          </label>
          <Input
            id={`alt-${image.id}`}
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            onBlur={saveAlt}
            placeholder="Describe this photo"
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={image.active}
              onCheckedChange={toggleActive}
              disabled={update.isPending}
            />
            <span className="text-muted-foreground">
              {image.active ? "Shown on site" : "Hidden"}
            </span>
          </label>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onMove(index, index - 1)}
              disabled={index === 0}
              aria-label="Move earlier"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onMove(index, index + 1)}
              disabled={index === total - 1}
              aria-label="Move later"
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  aria-label="Delete image"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove this photo?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes the image from the gallery and from
                    storage. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={doDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminGallery() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useGetAdminGallery();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const requestUrl = useRequestUploadUrl();
  const addImage = useAddGalleryImage();
  const reorder = useReorderGallery();

  const images = data ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetAdminGalleryQueryKey() });
    queryClient.invalidateQueries({
      queryKey: getGetStorefrontGalleryQueryKey(),
    });
  };

  const onPick = () => fileInput.current?.click();

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) {
          toast({
            title: "Not an image",
            description: `${file.name} was skipped.`,
            variant: "destructive",
          });
          continue;
        }
        if (file.size > MAX_BYTES) {
          toast({
            title: "Too large",
            description: `${file.name} is over 10 MB and was skipped.`,
            variant: "destructive",
          });
          continue;
        }

        // 1. Ask the server for a presigned upload URL.
        const { uploadURL, objectPath } = await requestUrl.mutateAsync({
          data: { name: file.name, size: file.size, contentType: file.type },
        });

        // 2. Upload the bytes directly to storage.
        const put = await fetch(uploadURL, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });
        if (!put.ok) {
          throw new Error(`Upload failed (${put.status})`);
        }

        // 3. Register the uploaded object as a gallery image.
        await addImage.mutateAsync({
          data: { object_path: objectPath, alt: "" },
        });
      }
      invalidate();
      toast({ title: "Photos uploaded" });
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= images.length) return;
    const ids = images.map((i) => i.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    reorder.mutate(
      { data: { ids } },
      {
        onSuccess: invalidate,
        onError: () =>
          toast({ title: "Could not reorder", variant: "destructive" }),
      },
    );
  };

  return (
    <AdminShell
      title="Gallery"
      subtitle="Upload and manage the photos shown in “A glimpse of The Seaboards” on the storefront."
    >
      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif text-primary">
            <Upload className="h-5 w-5" />
            Add photos
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
          <Button onClick={onPick} disabled={uploading}>
            {uploading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            {uploading ? "Uploading…" : "Choose images"}
          </Button>
          <p className="text-sm text-muted-foreground">
            JPG, PNG or WebP, up to 10 MB each. New photos are added to the end —
            reorder them below.
          </p>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Spinner className="h-8 w-8 text-primary" />
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">Could not load the gallery.</p>
      ) : images.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <ImageOff className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No photos yet. The storefront shows the built-in defaults until you
            upload your own.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((image, index) => (
            <ImageCard
              key={image.id}
              image={image}
              index={index}
              total={images.length}
              onMove={move}
            />
          ))}
        </div>
      )}
    </AdminShell>
  );
}
