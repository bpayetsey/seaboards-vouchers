import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPromoBanner,
  useUpdatePromoBanner,
  getGetPromoBannerQueryKey,
  getGetStorefrontConfigQueryKey,
  useGetWhatsappConfirmationSetting,
  useUpdateWhatsappConfirmationSetting,
  getGetWhatsappConfirmationSettingQueryKey,
} from "@workspace/api-client-react";
import { AdminShell } from "./AdminShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

const MAX_LENGTH = 500;

export default function AdminSiteContent() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, isError } = useGetPromoBanner();
  const update = useUpdatePromoBanner();

  const [banner, setBanner] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (data && !loaded) {
      setBanner(data.banner);
      setLoaded(true);
    }
  }, [data, loaded]);

  const dirty = loaded && data ? banner !== data.banner : false;

  const save = () => {
    if (banner.length > MAX_LENGTH) {
      toast({
        title: "Banner is too long",
        description: `Keep it under ${MAX_LENGTH} characters.`,
        variant: "destructive",
      });
      return;
    }
    update.mutate(
      { data: { banner } },
      {
        onSuccess: (res) => {
          setBanner(res.banner);
          queryClient.invalidateQueries({
            queryKey: getGetPromoBannerQueryKey(),
          });
          queryClient.invalidateQueries({
            queryKey: getGetStorefrontConfigQueryKey(),
          });
          toast({ title: "Promo banner updated" });
        },
        onError: () =>
          toast({
            title: "Could not save the banner",
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <AdminShell
      title="Promo Banner"
      subtitle="Edit the sale message shown on the storefront and group-order pages. Leave it blank to hide the banner entirely."
    >
      {isLoading ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Spinner className="h-8 w-8 text-primary" />
        </div>
      ) : isError || !data ? (
        <p className="text-sm text-destructive">Could not load the banner.</p>
      ) : (
        <Card className="border-border/70 max-w-2xl">
          <CardHeader>
            <CardTitle className="font-serif text-primary">
              Storefront promo banner
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="promo-banner"
                className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
              >
                Banner message
              </label>
              <Textarea
                id="promo-banner"
                rows={3}
                maxLength={MAX_LENGTH}
                value={banner}
                onChange={(e) => setBanner(e.target.value)}
                placeholder="e.g. Voucher for sale from 27 June – 15th July 2026, while allocation lasts. Blackout dates apply."
              />
              <p className="text-xs text-muted-foreground">
                The "Full Terms &amp; Conditions" link is added automatically
                after this text. {banner.length}/{MAX_LENGTH} characters.
              </p>
            </div>
            <div className="flex justify-end">
              <Button onClick={save} disabled={!dirty || update.isPending}>
                {update.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Save banner
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mt-6">
        <WhatsappConfirmationCard />
      </div>
    </AdminShell>
  );
}

/**
 * Staff-facing selector for the WhatsApp voucher-confirmation template.
 * Only Meta-approved templates can be chosen; picking "None" disables the
 * WhatsApp confirmation entirely (email is always sent regardless).
 */
function WhatsappConfirmationCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, isError } = useGetWhatsappConfirmationSetting();
  const update = useUpdateWhatsappConfirmationSetting();

  const [selected, setSelected] = useState<string | null>(null);
  const value = selected ?? data?.template ?? "";
  const dirty = data ? value !== data.template : false;

  const save = () => {
    update.mutate(
      { data: { template: value } },
      {
        onSuccess: (res) => {
          setSelected(res.template);
          queryClient.invalidateQueries({
            queryKey: getGetWhatsappConfirmationSettingQueryKey(),
          });
          toast({
            title: res.template
              ? "WhatsApp confirmations enabled"
              : "WhatsApp confirmations disabled",
          });
        },
        onError: (err) =>
          toast({
            title: "Could not save the setting",
            description:
              (err as { error?: string })?.error ?? "Please try again.",
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <Card className="border-border/70 max-w-2xl">
      <CardHeader>
        <CardTitle className="font-serif text-primary">
          WhatsApp voucher confirmations
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex min-h-[10vh] items-center justify-center">
            <Spinner className="h-6 w-6 text-primary" />
          </div>
        ) : isError || !data ? (
          <p className="text-sm text-destructive">
            Could not load the WhatsApp setting.
          </p>
        ) : !data.configured ? (
          <p className="text-sm text-muted-foreground">
            WhatsApp isn't connected yet. Add the WhatsApp Business API
            credentials to enable voucher confirmations — email confirmations
            are always sent either way.
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <label
                htmlFor="whatsapp-template"
                className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
              >
                Approved message template
              </label>
              <select
                id="whatsapp-template"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={value}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">None — WhatsApp confirmations off</option>
                {data.templates.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name} ({t.language})
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                When a voucher is issued, buyers receive this Meta-approved
                template on WhatsApp alongside the email. Free-text messages
                are never sent.
              </p>
              {data.templates.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No approved templates were found on the connected WhatsApp
                  account. Create and submit one for approval in WhatsApp
                  Manager first.
                </p>
              ) : null}
            </div>
            <div className="flex justify-end">
              <Button onClick={save} disabled={!dirty || update.isPending}>
                {update.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Save setting
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
