import { useMemo, useRef, useState } from "react";
import {
  useGetEmailContacts,
  useGetEmailAudiences,
  useImportEmailContacts,
  useOptOutEmailContact,
  useDeleteEmailContact,
  useCreateEmailAudience,
  useDeleteEmailAudience,
  useUpdateEmailAudienceMembers,
  getGetEmailContactsQueryKey,
  getGetEmailAudiencesQueryKey,
  type EmailImportContactRow,
  type EmailContact,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminShell } from "./AdminShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  Users,
  UserPlus,
  Trash2,
  Ban,
  Loader2,
  Search,
  FolderPlus,
} from "lucide-react";

/** Minimal CSV parser: splits rows, handles an optional email/name header. */
function parseCsv(text: string): EmailImportContactRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const splitRow = (line: string) =>
    line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));

  const header = splitRow(lines[0]).map((c) => c.toLowerCase());
  const hasHeader = header.some(
    (c) => c === "email" || c === "e-mail" || c === "name",
  );

  let emailIdx = 0;
  let nameIdx = 1;
  let startRow = 0;
  if (hasHeader) {
    startRow = 1;
    const ei = header.findIndex((c) => c === "email" || c === "e-mail");
    const ni = header.findIndex((c) => c === "name");
    if (ei >= 0) emailIdx = ei;
    if (ni >= 0) nameIdx = ni;
  }

  const rows: EmailImportContactRow[] = [];
  for (let i = startRow; i < lines.length; i++) {
    const cols = splitRow(lines[i]);
    const email = cols[emailIdx];
    if (!email) continue;
    rows.push({ email, name: cols[nameIdx] || null });
  }
  return rows;
}

function ImportCard({ audiences }: { audiences: { id: string; name: string }[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const importMut = useImportEmailContacts();
  const [raw, setRaw] = useState("");
  const [consent, setConsent] = useState(true);
  const [audienceId, setAudienceId] = useState("none");
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseCsv(raw), [raw]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setRaw(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const submit = () => {
    if (parsed.length === 0) {
      toast({ title: "No rows to import", variant: "destructive" });
      return;
    }
    importMut.mutate(
      {
        data: {
          rows: parsed,
          consent,
          audience_id: audienceId === "none" ? null : audienceId,
        },
      },
      {
        onSuccess: (res) => {
          toast({
            title: "Import complete",
            description: `${res.imported} added · ${res.duplicates} duplicates · ${res.rejected.length} rejected`,
          });
          setRaw("");
          if (fileRef.current) fileRef.current.value = "";
          qc.invalidateQueries({ queryKey: getGetEmailContactsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetEmailAudiencesQueryKey() });
        },
        onError: () =>
          toast({ title: "Import failed", variant: "destructive" }),
      },
    );
  };

  const result = importMut.data;

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-serif text-primary">
          <Upload className="h-5 w-5" />
          Import contacts
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Paste CSV rows or upload a file. Use an <code>email</code> column (with
          an optional <code>name</code>). Addresses are normalised and
          de-duplicated automatically.
        </p>
        <Textarea
          rows={6}
          placeholder={"email,name\njane@example.com,Jane Doe\njohn@example.com,John"}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          className="font-mono text-xs"
        />
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={onFile}
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />
          <Badge variant="secondary">{parsed.length} rows detected</Badge>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Add to audience (optional)</Label>
            <Select value={audienceId} onValueChange={setAudienceId}>
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {audiences.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={consent}
            onCheckedChange={(v) => setConsent(v === true)}
          />
          These contacts have consented to marketing emails
        </label>

        <Button onClick={submit} disabled={importMut.isPending}>
          {importMut.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-2 h-4 w-4" />
          )}
          Import {parsed.length > 0 ? `${parsed.length} contacts` : ""}
        </Button>

        {result ? (
          <div className="rounded-lg border border-border/60 bg-muted/30 p-4 text-sm">
            <p>
              <strong>{result.imported}</strong> imported ·{" "}
              <strong>{result.duplicates}</strong> duplicates ·{" "}
              <strong>{result.rejected.length}</strong> rejected
            </p>
            {result.rejected.length > 0 ? (
              <ul className="mt-2 max-h-32 space-y-1 overflow-auto text-xs text-muted-foreground">
                {result.rejected.slice(0, 20).map((r, i) => (
                  <li key={i}>
                    {r.email || "(blank)"} — {r.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AudiencesCard({
  audiences,
}: {
  audiences: { id: string; name: string; contact_count: number }[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const create = useCreateEmailAudience();
  const del = useDeleteEmailAudience();
  const [name, setName] = useState("");

  const refresh = () =>
    qc.invalidateQueries({ queryKey: getGetEmailAudiencesQueryKey() });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { data: { name: name.trim() } },
      {
        onSuccess: () => {
          setName("");
          toast({ title: "Audience created" });
          refresh();
        },
        onError: () =>
          toast({ title: "Could not create audience", variant: "destructive" }),
      },
    );
  };

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-serif text-primary">
          <FolderPlus className="h-5 w-5" />
          Audiences
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={submit} className="flex gap-2">
          <Input
            placeholder="New audience name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={create.isPending}>
            {create.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
          </Button>
        </form>

        {audiences.length === 0 ? (
          <p className="text-sm text-muted-foreground">No audiences yet.</p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
            {audiences.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between px-4 py-2.5"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{a.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.contact_count} contacts
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    del.mutate(
                      { audienceId: a.id },
                      {
                        onSuccess: () => {
                          toast({ title: "Audience deleted" });
                          refresh();
                        },
                      },
                    )
                  }
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ContactsCard({
  audiences,
}: {
  audiences: { id: string; name: string }[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [audienceId, setAudienceId] = useState("all");
  const [addTo, setAddTo] = useState("none");

  const { data, isLoading } = useGetEmailContacts({
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(audienceId !== "all" ? { audienceId } : {}),
  });
  const optOut = useOptOutEmailContact();
  const del = useDeleteEmailContact();
  const addMembers = useUpdateEmailAudienceMembers();

  const refresh = () =>
    qc.invalidateQueries({ queryKey: getGetEmailContactsQueryKey() });

  const contacts = data?.contacts ?? [];

  const statusBadge = (c: EmailContact) => {
    if (c.opted_out) return <Badge variant="destructive">Opted out</Badge>;
    if (c.consent !== "opted_in")
      return <Badge variant="secondary">No consent</Badge>;
    return (
      <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
        Subscribed
      </Badge>
    );
  };

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-serif text-primary">
          <Users className="h-5 w-5" />
          Contacts{" "}
          {data ? (
            <span className="text-sm font-normal text-muted-foreground">
              ({data.eligible} reachable / {data.total})
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search name or email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select value={audienceId} onValueChange={setAudienceId}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All contacts</SelectItem>
              {audiences.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {audiences.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm">
            <span className="text-muted-foreground">
              Add all shown contacts to:
            </span>
            <Select value={addTo} onValueChange={setAddTo}>
              <SelectTrigger className="h-8 w-[180px]">
                <SelectValue placeholder="Select audience" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Select audience</SelectItem>
                {audiences.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              disabled={
                addTo === "none" ||
                contacts.length === 0 ||
                addMembers.isPending
              }
              onClick={() =>
                addMembers.mutate(
                  {
                    audienceId: addTo,
                    data: { add: contacts.map((c) => c.id) },
                  },
                  {
                    onSuccess: () => {
                      toast({ title: "Contacts added to audience" });
                      qc.invalidateQueries({
                        queryKey: getGetEmailAudiencesQueryKey(),
                      });
                    },
                    onError: () =>
                      toast({ title: "Could not add", variant: "destructive" }),
                  },
                )
              }
            >
              Add {contacts.length}
            </Button>
          </div>
        ) : null}

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : contacts.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No contacts found.
          </p>
        ) : (
          <div className="max-h-[420px] overflow-auto rounded-lg border border-border/60">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      {c.name || "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {c.email}
                    </TableCell>
                    <TableCell>{statusBadge(c)}</TableCell>
                    <TableCell className="text-right">
                      {!c.opted_out ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Opt out"
                          onClick={() =>
                            optOut.mutate(
                              { contactId: c.id },
                              {
                                onSuccess: () => {
                                  toast({ title: "Contact opted out" });
                                  refresh();
                                },
                              },
                            )
                          }
                        >
                          <Ban className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Delete"
                        onClick={() =>
                          del.mutate(
                            { contactId: c.id },
                            {
                              onSuccess: () => {
                                toast({ title: "Contact removed" });
                                refresh();
                              },
                            },
                          )
                        }
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
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

export default function AdminEmailAudiences() {
  const { data: audiencesData } = useGetEmailAudiences();
  const audiences = audiencesData?.audiences ?? [];

  return (
    <AdminShell
      title="Email Audiences"
      subtitle="Import contacts, manage opt-outs and organise recipients into audiences for email campaigns."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <ImportCard audiences={audiences} />
        <AudiencesCard audiences={audiences} />
      </div>
      <div className="mt-6">
        <ContactsCard audiences={audiences} />
      </div>
    </AdminShell>
  );
}
