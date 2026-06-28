import { useState } from "react";
import {
  useGetAdminInbox,
  useMarkMessageRead,
  useMarkThreadRead,
  useSendInboxReply,
  getGetAdminInboxQueryKey,
  getGetAdminInboxUnreadCountQueryKey,
  type AdminInbox,
  type InboxThread,
  type InboxMessage,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminShell } from "./AdminShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  MessageCircle,
  Mail,
  ChevronDown,
  ChevronUp,
  Image,
  Send,
} from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) {
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) {
    return d.toLocaleDateString("en-GB", { weekday: "short" });
  }
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: diffDays > 365 ? "numeric" : undefined,
  });
}

function ChannelBadge({ channel }: { channel: string }) {
  if (channel === "whatsapp") {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200 gap-1 text-xs">
        <MessageCircle className="h-3 w-3" />
        WhatsApp
      </Badge>
    );
  }
  return (
    <Badge className="bg-blue-100 text-blue-800 border-blue-200 gap-1 text-xs">
      <Mail className="h-3 w-3" />
      Email
    </Badge>
  );
}

// ─── Single message row ───────────────────────────────────────────────────────

function MessageRow({
  msg,
  onToggleRead,
}: {
  msg: InboxMessage;
  onToggleRead: (msg: InboxMessage) => void;
}) {
  const isOutbound = msg.direction === "outbound";

  if (isOutbound) {
    return (
      <div className="px-4 py-3 border-b last:border-b-0 text-sm bg-primary/5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-primary mb-0.5 flex items-center gap-1">
              <Send className="h-3 w-3" />
              You replied
              {msg.sent_by_email ? ` · ${msg.sent_by_email}` : ""}
            </p>
            {msg.subject && (
              <p className="font-medium text-foreground truncate mb-0.5">
                {msg.subject}
              </p>
            )}
            <p className="text-foreground whitespace-pre-wrap break-words">
              {msg.body}
            </p>
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
            {formatDate(msg.received_at)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`px-4 py-3 border-b last:border-b-0 text-sm transition-colors ${
        !msg.read ? "bg-amber-50/60" : "bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {msg.subject && (
            <p className="font-medium text-foreground truncate mb-0.5">
              {msg.subject}
            </p>
          )}
          {msg.has_media && !msg.body && (
            <p className="text-muted-foreground italic flex items-center gap-1">
              <Image className="h-3.5 w-3.5" />
              Media attachment (not stored)
            </p>
          )}
          {msg.body ? (
            <p className="text-muted-foreground whitespace-pre-wrap break-words line-clamp-3">
              {msg.body}
            </p>
          ) : null}
          {msg.has_media && msg.body && (
            <p className="text-muted-foreground italic flex items-center gap-1 mt-1 text-xs">
              <Image className="h-3 w-3" />
              Included media attachment (not stored)
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {formatDate(msg.received_at)}
          </span>
          <button
            onClick={() => onToggleRead(msg)}
            className={`text-xs font-medium transition-colors ${
              msg.read
                ? "text-muted-foreground hover:text-foreground"
                : "text-primary hover:text-primary/80"
            }`}
            title={msg.read ? "Mark as unread" : "Mark as read"}
          >
            {msg.read ? "Mark unread" : "Mark read"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Reply composer ───────────────────────────────────────────────────────────

function ReplyComposer({ thread }: { thread: InboxThread }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isEmail = thread.channel === "email";

  const sendReply = useSendInboxReply({
    mutation: {
      onSuccess: () => {
        setBody("");
        setSubject("");
        setError(null);
        void qc.invalidateQueries({ queryKey: getGetAdminInboxQueryKey() });
        void qc.invalidateQueries({
          queryKey: getGetAdminInboxUnreadCountQueryKey(),
        });
      },
      onError: (err) => {
        const message =
          (err as { error?: string })?.error ??
          "Could not send the reply. Please try again.";
        setError(message);
      },
    },
  });

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    const trimmed = body.trim();
    if (!trimmed) return;
    setError(null);
    sendReply.mutate({
      data: {
        channel: thread.channel as "whatsapp" | "email",
        sender: thread.sender,
        body: trimmed,
        ...(isEmail && subject.trim() ? { subject: subject.trim() } : {}),
      },
    });
  }

  return (
    <form
      onSubmit={handleSend}
      onClick={(e) => e.stopPropagation()}
      className="px-4 py-3 border-t border-border bg-muted/20 space-y-2"
    >
      {isEmail && (
        <Input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject (optional)"
          className="bg-white"
        />
      )}
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={
          isEmail
            ? "Write an email reply…"
            : "Write a WhatsApp reply…"
        }
        rows={3}
        className="bg-white resize-none"
      />
      {error && <p className="text-destructive text-xs">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {isEmail
            ? `Sends an email to ${thread.sender}`
            : "WhatsApp replies must be within 24h of the customer's last message"}
        </p>
        <Button
          type="submit"
          size="sm"
          disabled={!body.trim() || sendReply.isPending}
          className="gap-1.5"
        >
          {sendReply.isPending ? (
            <Spinner className="h-3.5 w-3.5" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          Send reply
        </Button>
      </div>
    </form>
  );
}

// ─── Thread card ──────────────────────────────────────────────────────────────

function ThreadCard({
  thread,
  onToggleMessageRead,
  onMarkThreadRead,
}: {
  thread: InboxThread;
  onToggleMessageRead: (msg: InboxMessage) => void;
  onMarkThreadRead: (thread: InboxThread, read: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasUnread = thread.unread_count > 0;

  return (
    <Card className={`overflow-hidden ${hasUnread ? "ring-2 ring-primary/20" : ""}`}>
      <CardHeader
        className="py-3 px-4 cursor-pointer select-none"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <ChannelBadge channel={thread.channel} />
            <div className="min-w-0">
              <p className={`text-sm truncate ${hasUnread ? "font-semibold" : "font-medium"}`}>
                {thread.display_name || thread.sender}
              </p>
              {thread.display_name && (
                <p className="text-xs text-muted-foreground truncate">{thread.sender}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {hasUnread && (
              <span className="inline-flex items-center justify-center h-5 min-w-[1.25rem] px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                {thread.unread_count}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {formatDate(thread.last_received_at)}
            </span>
            <span className="text-xs text-muted-foreground">
              {thread.messages.length} msg{thread.messages.length !== 1 ? "s" : ""}
            </span>
            {expanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="p-0">
          <div className="border-t border-border">
            {thread.messages.map((msg) => (
              <MessageRow key={msg.id} msg={msg} onToggleRead={onToggleMessageRead} />
            ))}
          </div>
          <div className="flex gap-2 px-4 py-3 border-t border-border bg-muted/30">
            {hasUnread ? (
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  onMarkThreadRead(thread, true);
                }}
              >
                Mark all read
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  onMarkThreadRead(thread, false);
                }}
              >
                Mark all unread
              </Button>
            )}
          </div>
          <ReplyComposer thread={thread} />
        </CardContent>
      )}
    </Card>
  );
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

type ChannelFilter = "all" | "whatsapp" | "email";
type ReadFilter = "all" | "unread";

function FilterBar({
  channel,
  readState,
  onChannel,
  onReadState,
}: {
  channel: ChannelFilter;
  readState: ReadFilter;
  onChannel: (v: ChannelFilter) => void;
  onReadState: (v: ReadFilter) => void;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      <Select value={channel} onValueChange={(v) => onChannel(v as ChannelFilter)}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Channel" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All channels</SelectItem>
          <SelectItem value="whatsapp">WhatsApp only</SelectItem>
          <SelectItem value="email">Email only</SelectItem>
        </SelectContent>
      </Select>

      <Select value={readState} onValueChange={(v) => onReadState(v as ReadFilter)}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Read state" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All messages</SelectItem>
          <SelectItem value="unread">Unread only</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function AdminInbox() {
  const qc = useQueryClient();
  const [channel, setChannel] = useState<ChannelFilter>("all");
  const [readState, setReadState] = useState<ReadFilter>("all");

  const params = {
    ...(channel !== "all" ? { channel: channel as "whatsapp" | "email" } : {}),
    ...(readState === "unread" ? { unread_only: true } : {}),
  };

  const { data, isLoading, isError } = useGetAdminInbox(
    Object.keys(params).length > 0 ? params : undefined,
  );

  const markMessage = useMarkMessageRead({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getGetAdminInboxQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetAdminInboxUnreadCountQueryKey() });
      },
    },
  });

  const markThread = useMarkThreadRead({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getGetAdminInboxQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetAdminInboxUnreadCountQueryKey() });
      },
    },
  });

  function handleToggleMessageRead(msg: InboxMessage) {
    markMessage.mutate({ messageId: msg.id, data: { read: !msg.read } });
  }

  function handleMarkThreadRead(thread: InboxThread, read: boolean) {
    markThread.mutate({ sender: encodeURIComponent(thread.sender), data: { read } });
  }

  const threads: AdminInbox["threads"] = data?.threads ?? [];
  const totalUnread = data?.total_unread ?? 0;

  return (
    <AdminShell
      title="Inbox"
      subtitle="Inbound WhatsApp replies and email responses from customers."
    >
      <div className="space-y-6">
        {totalUnread > 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center justify-center h-5 min-w-[1.25rem] px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold">
              {totalUnread}
            </span>
            unread message{totalUnread !== 1 ? "s" : ""}
          </div>
        )}

        <FilterBar
          channel={channel}
          readState={readState}
          onChannel={setChannel}
          onReadState={setReadState}
        />

        {isLoading && (
          <div className="flex justify-center py-16">
            <Spinner className="h-8 w-8 text-primary" />
          </div>
        )}

        {isError && (
          <p className="text-destructive text-sm">Failed to load inbox. Please try again.</p>
        )}

        {!isLoading && !isError && threads.length === 0 && (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <MessageCircle className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No messages yet</p>
              <p className="text-sm mt-1">
                WhatsApp replies and incoming emails will appear here once the webhooks are
                configured.
              </p>
            </CardContent>
          </Card>
        )}

        {threads.map((thread) => (
          <ThreadCard
            key={`${thread.channel}::${thread.sender}`}
            thread={thread}
            onToggleMessageRead={handleToggleMessageRead}
            onMarkThreadRead={handleMarkThreadRead}
          />
        ))}
      </div>
    </AdminShell>
  );
}
