import { useMemo, useState } from "react";
import {
  useGetEmailConfig,
  useGetEmailAudiences,
  useGetEmailCampaigns,
  useGetEmailCampaign,
  useCreateEmailCampaign,
  useSendEmailCampaign,
  getGetEmailCampaignsQueryKey,
  getGetEmailCampaignQueryKey,
  type EmailCampaignSummary,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminShell } from "./AdminShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

/**
 * Mirror the server-side fill: positional {{1}}..{{n}} come from the variable
 * inputs, and {{name}} previews as a sample recipient name.
 */
function fillTemplate(text: string, vars: string[], sampleName: string): string {
  return text
    .replace(/\{\{\s*name\s*\}\}/gi, sampleName || "there")
    .replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => {
      const idx = Number(n) - 1;
      return vars[idx]?.trim() ? vars[idx] : `{{${n}}}`;
    });
}

/** Highest positional placeholder index referenced across subject + body. */
function maxPlaceholder(text: string): number {
  let max = 0;
  for (const m of text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    max = Math.max(max, Number(m[1]));
  }
  return max;
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
  fromEmail,
  audiences,
}: {
  configured: boolean;
  fromEmail: string | null;
  audiences: { id: string; name: string; contact_count: number }[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const create = useCreateEmailCampaign();

  const [name, setName] = useState("");
  const [audienceId, setAudienceId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [vars, setVars] = useState<string[]>([]);
  const [scheduledAt, setScheduledAt] = useState("");
  const [dailyLimit, setDailyLimit] = useState("2000");

  const placeholderCount = useMemo(
    () => Math.max(maxPlaceholder(subject), maxPlaceholder(body)),
    [subject, body],
  );

  const submit = (mode: "draft" | "now" | "schedule") => {
    if (!name.trim()) {
      toast({ title: "Name your campaign", variant: "destructive" });
      return;
    }
    if (!audienceId) {
      toast({ title: "Choose an audience", variant: "destructive" });
      return;
    }
    if (!subject.trim()) {
      toast({ title: "Add a subject", variant: "destructive" });
      return;
    }
    if (!body.trim()) {
      toast({ title: "Write the email body", variant: "destructive" });
      return;
    }
    if (mode === "schedule" && !scheduledAt) {
      toast({ title: "Pick a send time", variant: "destructive" });
      return;
    }
    const parsedLimit = Number.parseInt(dailyLimit, 10);
    create.mutate(
      {
        data: {
          name: name.trim(),
          audience_id: audienceId,
          subject: subject.trim(),
          body,
          variables: vars.slice(0, placeholderCount),
          mode,
          scheduled_at:
            mode === "schedule" ? new Date(scheduledAt).toISOString() : null,
          daily_limit:
            Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null,
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
          setSubject("");
          setBody("");
          setVars([]);
          setScheduledAt("");
          qc.invalidateQueries({
            queryKey: getGetEmailCampaignsQueryKey(),
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
          Compose email
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!configured ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Email sending is not configured yet. You can build and save drafts;
              connect SendGrid to send.
            </span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Sending from <strong>{fromEmail}</strong>. Every email includes a
            one-click unsubscribe link automatically.
          </p>
        )}

        <div className="space-y-1.5">
          <Label>Campaign name</Label>
          <Input
            placeholder="Golden Jubilee — June offer"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

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
          <Label>Subject</Label>
          <Input
            placeholder="A golden welcome back, {{name}}"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Body</Label>
          <Textarea
            rows={8}
            placeholder={
              "Dear {{name}},\n\nWe're celebrating 50 years with an exclusive offer: {{1}}.\n\nWarm regards,\nThe Seaboards Apartments"
            }
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Use <code>{"{{name}}"}</code> for the recipient's name and{" "}
            <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code>… for campaign values
            you fill in below.
          </p>
        </div>

        {placeholderCount > 0 ? (
          <div className="space-y-2">
            <Label>Placeholder values</Label>
            {Array.from({ length: placeholderCount }).map((_, i) => (
              <Input
                key={i}
                placeholder={`Value for {{${i + 1}}}`}
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

        {subject.trim() || body.trim() ? (
          <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
            <p className="mb-1 font-sans text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Preview
            </p>
            <p className="text-sm font-semibold text-foreground">
              {fillTemplate(subject, vars, "Jane") || "(no subject)"}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
              {fillTemplate(body, vars, "Jane")}
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
            disabled={create.isPending || !configured || !scheduledAt}
          >
            <Clock className="mr-2 h-4 w-4" />
            Schedule
          </Button>
          <Button
            onClick={() => submit("now")}
            disabled={create.isPending || !configured}
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
  const { data, isLoading } = useGetEmailCampaign(campaignId, {
    query: {
      queryKey: getGetEmailCampaignQueryKey(campaignId),
      refetchInterval: 5000,
    },
  });
  const send = useSendEmailCampaign();

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
            queryKey: getGetEmailCampaignQueryKey(campaignId),
          });
          qc.invalidateQueries({
            queryKey: getGetEmailCampaignsQueryKey(),
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
                {data.audience_name} · {data.subject}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {(
                [
                  ["Total", data.stats.total],
                  ["Queued", data.stats.queued],
                  ["Sent", data.stats.sent],
                  ["Delivered", data.stats.delivered],
                  ["Opened", data.stats.opened],
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
                    <TableHead>Email</TableHead>
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
                        {r.email}
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
  campaigns: EmailCampaignSummary[];
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
                      {c.stats.sent + c.stats.delivered + c.stats.opened}/
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

export default function AdminEmailCampaigns() {
  const { data: config } = useGetEmailConfig();
  const { data: audiencesData } = useGetEmailAudiences();
  const { data: campaignsData } = useGetEmailCampaigns({
    query: {
      queryKey: getGetEmailCampaignsQueryKey(),
      refetchInterval: 8000,
    },
  });
  const [viewId, setViewId] = useState<string | null>(null);

  const audiences = audiencesData?.audiences ?? [];
  const campaigns = campaignsData?.campaigns ?? [];

  return (
    <AdminShell
      title="Email Campaigns"
      subtitle="Compose subject + body emails, send or schedule them, and track per-recipient delivery."
    >
      <div className="space-y-6">
        <ComposerCard
          configured={config?.configured ?? false}
          fromEmail={config?.from_email ?? null}
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
