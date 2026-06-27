import { useMemo, useState } from "react";
import {
  useGetWhatsappConfig,
  useGetWhatsappAudiences,
  useGetWhatsappCampaigns,
  useGetWhatsappCampaign,
  useCreateWhatsappCampaign,
  useSendWhatsappCampaign,
  getGetWhatsappCampaignsQueryKey,
  getGetWhatsappCampaignQueryKey,
  type WhatsappTemplate,
  type WhatsappCampaignSummary,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminShell } from "./AdminShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Megaphone,
  Send,
  Clock,
  Save,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Eye,
} from "lucide-react";

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fillTemplate(body: string, vars: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => {
    const idx = Number(n) - 1;
    return vars[idx]?.trim() ? vars[idx] : `{{${n}}}`;
  });
}

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  scheduled: "bg-amber-100 text-amber-800",
  sending: "bg-blue-100 text-blue-800",
  completed: "bg-primary/10 text-primary",
  failed: "bg-destructive/10 text-destructive",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
        STATUS_STYLE[status] ?? "bg-muted text-muted-foreground"
      }`}
    >
      {status}
    </span>
  );
}

function ComposerCard({
  configured,
  templates,
  audiences,
}: {
  configured: boolean;
  templates: WhatsappTemplate[];
  audiences: { id: string; name: string; contact_count: number }[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const create = useCreateWhatsappCampaign();

  const [name, setName] = useState("");
  const [audienceId, setAudienceId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [vars, setVars] = useState<string[]>([]);
  const [scheduledAt, setScheduledAt] = useState("");
  const [dailyLimit, setDailyLimit] = useState("2000");
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<string | null>(null);
  const [mediaName, setMediaName] = useState("");
  const [uploading, setUploading] = useState(false);

  const template = useMemo(
    () => templates.find((t) => t.name === templateName),
    [templates, templateName],
  );

  const mediaFormat = (template?.header_format ?? "NONE").toUpperCase();
  const needsMedia =
    mediaFormat === "IMAGE" ||
    mediaFormat === "VIDEO" ||
    mediaFormat === "DOCUMENT";
  const mediaAccept =
    mediaFormat === "VIDEO"
      ? "video/*"
      : mediaFormat === "IMAGE"
        ? "image/*"
        : undefined;

  const resetMedia = () => {
    setMediaId(null);
    setMediaType(null);
    setMediaName("");
  };

  const onTemplateChange = (value: string) => {
    setTemplateName(value);
    const t = templates.find((x) => x.name === value);
    setVars(Array(t?.variable_count ?? 0).fill(""));
    resetMedia();
  };

  const onMediaSelected = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const resp = await fetch("/api/admin/whatsapp/media", {
        method: "POST",
        headers: {
          "content-type": file.type || "application/octet-stream",
          "x-filename": file.name,
        },
        body: file,
      });
      if (!resp.ok) {
        const err = (await resp.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(err.error ?? `Upload failed (${resp.status})`);
      }
      const data = (await resp.json()) as {
        media_id: string;
        media_type: string;
      };
      setMediaId(data.media_id);
      setMediaType(data.media_type);
      setMediaName(file.name);
      toast({ title: "Media uploaded" });
    } catch (e) {
      resetMedia();
      toast({
        title: "Could not upload media",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const submit = (mode: "draft" | "now" | "schedule") => {
    if (!name.trim()) {
      toast({ title: "Name your campaign", variant: "destructive" });
      return;
    }
    if (!audienceId) {
      toast({ title: "Choose an audience", variant: "destructive" });
      return;
    }
    if (!template) {
      toast({ title: "Choose a template", variant: "destructive" });
      return;
    }
    if (mode === "schedule" && !scheduledAt) {
      toast({ title: "Pick a send time", variant: "destructive" });
      return;
    }
    if (needsMedia && !mediaId) {
      toast({
        title: "Upload the header media",
        description: "This template requires a header image/video.",
        variant: "destructive",
      });
      return;
    }
    const parsedLimit = Number.parseInt(dailyLimit, 10);
    create.mutate(
      {
        data: {
          name: name.trim(),
          audience_id: audienceId,
          template_name: template.name,
          template_language: template.language,
          variables: vars,
          mode,
          scheduled_at:
            mode === "schedule" ? new Date(scheduledAt).toISOString() : null,
          daily_limit:
            Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null,
          header_media_id: needsMedia ? mediaId : null,
          header_media_type: needsMedia ? mediaType : null,
        },
      },
      {
        onSuccess: () => {
          toast({
            title:
              mode === "now"
                ? "Campaign sending"
                : mode === "schedule"
                  ? "Campaign scheduled"
                  : "Draft saved",
          });
          setName("");
          setVars(Array(template.variable_count).fill(""));
          setScheduledAt("");
          resetMedia();
          qc.invalidateQueries({
            queryKey: getGetWhatsappCampaignsQueryKey(),
          });
        },
        onError: () =>
          toast({ title: "Could not create campaign", variant: "destructive" }),
      },
    );
  };

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-serif text-primary">
          <Megaphone className="h-5 w-5" />
          Compose broadcast
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!configured ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              WhatsApp sending is not configured yet. You can build and save
              drafts; connect the WhatsApp Cloud API credentials to send.
            </span>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label>Campaign name</Label>
          <Input
            placeholder="Golden Jubilee — June offer"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Audience</Label>
            <Select value={audienceId} onValueChange={setAudienceId}>
              <SelectTrigger>
                <SelectValue placeholder="Select audience" />
              </SelectTrigger>
              <SelectContent>
                {audiences.length === 0 ? (
                  <SelectItem value="none" disabled>
                    No audiences yet
                  </SelectItem>
                ) : (
                  audiences.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} ({a.contact_count})
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Template</Label>
            <Select value={templateName} onValueChange={onTemplateChange}>
              <SelectTrigger>
                <SelectValue placeholder="Approved template" />
              </SelectTrigger>
              <SelectContent>
                {templates.length === 0 ? (
                  <SelectItem value="none" disabled>
                    No approved templates
                  </SelectItem>
                ) : (
                  templates.map((t) => (
                    <SelectItem key={`${t.name}/${t.language}`} value={t.name}>
                      {t.name} · {t.language}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        {template && template.variable_count > 0 ? (
          <div className="space-y-2">
            <Label>Template variables</Label>
            {Array.from({ length: template.variable_count }).map((_, i) => (
              <Input
                key={i}
                placeholder={`Variable {{${i + 1}}}`}
                value={vars[i] ?? ""}
                onChange={(e) => {
                  const next = [...vars];
                  next[i] = e.target.value;
                  setVars(next);
                }}
              />
            ))}
          </div>
        ) : null}

        {needsMedia ? (
          <div className="space-y-1.5">
            <Label>
              Header {mediaFormat.toLowerCase()}{" "}
              <span className="text-destructive">*</span>
            </Label>
            <Input
              type="file"
              accept={mediaAccept}
              disabled={uploading}
              onChange={(e) => {
                void onMediaSelected(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {uploading ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Uploading to WhatsApp…
              </p>
            ) : mediaId ? (
              <p className="flex items-center gap-1.5 text-xs text-primary">
                <CheckCircle2 className="h-3 w-3" />
                {mediaName} uploaded
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Required by this template. Max 16MB for video.
              </p>
            )}
          </div>
        ) : null}

        {template ? (
          <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
            <p className="mb-1 font-sans text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Preview
            </p>
            <p className="whitespace-pre-wrap text-sm text-foreground">
              {fillTemplate(template.body, vars)}
            </p>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Daily send limit</Label>
            <Input
              type="number"
              min={1}
              placeholder="2000"
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Sends up to this many per day, then resumes automatically the next
              day. Leave blank to send the whole audience at once.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Schedule for (optional)</Label>
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => submit("draft")}
            disabled={create.isPending}
          >
            <Save className="mr-2 h-4 w-4" />
            Save draft
          </Button>
          <Button
            variant="outline"
            onClick={() => submit("schedule")}
            disabled={create.isPending || uploading || !configured || !scheduledAt}
          >
            <Clock className="mr-2 h-4 w-4" />
            Schedule
          </Button>
          <Button
            onClick={() => submit("now")}
            disabled={create.isPending || uploading || !configured}
          >
            {create.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Send now
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CampaignReport({
  campaignId,
  onClose,
}: {
  campaignId: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useGetWhatsappCampaign(campaignId, {
    query: {
      queryKey: getGetWhatsappCampaignQueryKey(campaignId),
      refetchInterval: 5000,
    },
  });
  const send = useSendWhatsappCampaign();

  const doSend = (mode: "now" | "schedule", scheduledAt?: string) => {
    send.mutate(
      {
        campaignId,
        data: {
          mode,
          scheduled_at: scheduledAt
            ? new Date(scheduledAt).toISOString()
            : null,
        },
      },
      {
        onSuccess: () => {
          toast({ title: mode === "now" ? "Sending started" : "Scheduled" });
          qc.invalidateQueries({
            queryKey: getGetWhatsappCampaignQueryKey(campaignId),
          });
          qc.invalidateQueries({
            queryKey: getGetWhatsappCampaignsQueryKey(),
          });
        },
        onError: () => toast({ title: "Could not send", variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-primary">
            {data?.name ?? "Campaign"}
          </DialogTitle>
        </DialogHeader>

        {isLoading || !data ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <StatusBadge status={data.status} />
              <span className="text-muted-foreground">
                {data.audience_name} · {data.template_name} ·{" "}
                {data.template_language}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {(
                [
                  ["Total", data.stats.total],
                  ["Queued", data.stats.queued],
                  ["Sent", data.stats.sent],
                  ["Delivered", data.stats.delivered],
                  ["Read", data.stats.read],
                  ["Failed", data.stats.failed],
                ] as const
              ).map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-lg border border-border/60 p-3 text-center"
                >
                  <p className="text-lg font-semibold text-primary">{value}</p>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {label}
                  </p>
                </div>
              ))}
            </div>

            {data.status === "draft" || data.status === "scheduled" ? (
              <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                <span className="text-sm text-muted-foreground">
                  {data.status === "scheduled"
                    ? `Scheduled for ${formatDate(data.scheduled_at)}`
                    : "This campaign is a draft."}
                </span>
                <Button
                  size="sm"
                  className="ml-auto"
                  onClick={() => doSend("now")}
                  disabled={send.isPending}
                >
                  <Send className="mr-2 h-4 w-4" />
                  Send now
                </Button>
              </div>
            ) : null}

            <div className="max-h-[40vh] overflow-auto rounded-lg border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Number</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recipients.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        {r.name || "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.phone}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate text-xs text-muted-foreground">
                        {r.error || formatDate(r.sent_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CampaignsListCard({
  campaigns,
  onView,
}: {
  campaigns: WhatsappCampaignSummary[];
  onView: (id: string) => void;
}) {
  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-serif text-primary">
          <CheckCircle2 className="h-5 w-5" />
          Campaigns
        </CardTitle>
      </CardHeader>
      <CardContent>
        {campaigns.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No campaigns yet.
          </p>
        ) : (
          <div className="overflow-auto rounded-lg border border-border/60">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Audience</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">View</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.audience_name}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {c.stats.sent + c.stats.delivered + c.stats.read}/
                      {c.stats.total} sent
                      {c.stats.failed > 0 ? ` · ${c.stats.failed} failed` : ""}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(c.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onView(c.id)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminWhatsappCampaigns() {
  const { data: config } = useGetWhatsappConfig();
  const { data: audiencesData } = useGetWhatsappAudiences();
  const { data: campaignsData } = useGetWhatsappCampaigns({
    query: {
      queryKey: getGetWhatsappCampaignsQueryKey(),
      refetchInterval: 8000,
    },
  });
  const [viewId, setViewId] = useState<string | null>(null);

  const templates = config?.templates ?? [];
  const audiences = audiencesData?.audiences ?? [];
  const campaigns = campaignsData?.campaigns ?? [];

  return (
    <AdminShell
      title="WhatsApp Broadcasts"
      subtitle="Compose template-based campaigns, send or schedule them, and track per-recipient delivery."
    >
      <div className="space-y-6">
        <ComposerCard
          configured={config?.configured ?? false}
          templates={templates}
          audiences={audiences}
        />
        <CampaignsListCard campaigns={campaigns} onView={setViewId} />
      </div>
      {viewId ? (
        <CampaignReport campaignId={viewId} onClose={() => setViewId(null)} />
      ) : null}
    </AdminShell>
  );
}
