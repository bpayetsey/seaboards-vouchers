import { useParams } from "wouter";
import { format } from "date-fns";
import { Layout } from "@/components/layout";
import { useGetGroupOrder, useResendLine } from "@workspace/api-client-react";
import { formatMoney } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, Clock, Mail, Copy, Check, Users, Calendar, Home as HomeIcon, CreditCard } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getGetGroupOrderQueryKey } from "@workspace/api-client-react";

export default function GroupDashboard() {
  const params = useParams();
  const statusToken = params.statusToken as string;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: order, isLoading, error } = useGetGroupOrder(statusToken, {
    query: {
      enabled: !!statusToken,
      queryKey: getGetGroupOrderQueryKey(statusToken)
    }
  });

  const resend = useResendLine();
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedLink(text);
    setTimeout(() => setCopiedLink(null), 2000);
    toast({ title: "Link copied to clipboard" });
  };

  const handleResend = (lineId: string, email: string) => {
    resend.mutate({ statusToken, lineId }, {
      onSuccess: () => {
        toast({ title: `Reminder sent to ${email}` });
      },
      onError: (err: any) => {
        toast({ 
          title: "Failed to send reminder", 
          description: err.error || "An error occurred",
          variant: "destructive" 
        });
      }
    });
  };

  if (error) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-20 text-center">
          <h1 className="text-3xl font-serif text-destructive mb-4">Dashboard Not Found</h1>
          <p className="text-muted-foreground">This group order does not exist or has been removed.</p>
        </div>
      </Layout>
    );
  }

  if (isLoading || !order) {
    return (
      <Layout>
        <div className="container max-w-5xl mx-auto px-4 py-12 space-y-8">
          <Skeleton className="h-24 w-full" />
          <div className="grid md:grid-cols-3 gap-6">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full md:col-span-1" />
          </div>
          <Skeleton className="h-[400px] w-full" />
        </div>
      </Layout>
    );
  }

  const isComplete = order.status === "completed";
  const progressPercent = Math.round((order.paid_count / order.total_count) * 100);

  return (
    <Layout>
      <div className="bg-primary/5 border-b border-border pb-12 pt-8 mb-8">
        <div className="container max-w-5xl mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-8">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <Badge variant={isComplete ? "default" : "secondary"} className="text-xs uppercase tracking-wider font-sans">
                  {isComplete ? "Completed" : "In Progress"}
                </Badge>
                <span className="text-sm text-muted-foreground font-medium uppercase tracking-widest">{order.mode} Order</span>
              </div>
              <h1 className="text-3xl md:text-4xl font-serif text-foreground">Group Order Dashboard</h1>
              <p className="text-muted-foreground mt-2 font-medium">Organised by {order.organiser_name}</p>
            </div>
            
            {order.due_by && (
              <div className="bg-background border border-border rounded-lg p-3 flex items-center gap-3 shadow-sm">
                <div className="bg-primary/10 p-2 rounded-full text-primary">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Due Date</p>
                  <p className="font-medium">{format(new Date(order.due_by), "MMM d, yyyy")}</p>
                </div>
              </div>
            )}
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <Card className="shadow-sm border-transparent bg-background/80 backdrop-blur">
              <CardContent className="p-6 flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                  <Users className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground font-medium">Participants</p>
                  <p className="text-2xl font-serif font-semibold">{order.total_count}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-transparent bg-background/80 backdrop-blur">
              <CardContent className="p-6 flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center text-accent shrink-0">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-end mb-1">
                    <p className="text-sm text-muted-foreground font-medium">Payment Progress</p>
                    <p className="text-sm font-semibold">{order.paid_count} / {order.total_count}</p>
                  </div>
                  <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-accent transition-all duration-1000 ease-out" 
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {order.mode === "split" && order.split_apartment_type && (
              <Card className="shadow-sm border-transparent bg-background/80 backdrop-blur">
                <CardContent className="p-6">
                  <p className="text-sm text-muted-foreground font-medium mb-2">Shared Booking</p>
                  <div className="flex gap-4">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <HomeIcon className="w-4 h-4 text-primary" />
                      {order.split_apartment_type === "one_bedroom" ? "1 Bed" : "2 Bed"}
                    </div>
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <Calendar className="w-4 h-4 text-primary" />
                      {order.split_nights} Nights
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      <div className="container max-w-5xl mx-auto px-4 pb-20">
        
        {order.mode === "split" && order.split_voucher_code && (
          <Card className="mb-8 border-primary bg-primary/5 shadow-md">
            <CardHeader className="pb-3">
              <CardTitle className="text-primary flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5" /> Master Voucher Ready
              </CardTitle>
              <CardDescription>
                The group payment is complete. Use this code when booking.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-mono tracking-widest font-bold text-center py-6 bg-background rounded-md border border-border">
                {order.split_voucher_code}
              </div>
            </CardContent>
          </Card>
        )}

        <h2 className="text-2xl font-serif mb-6 border-b pb-2">Participant Details</h2>
        
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="divide-y divide-border">
            {order.lines.map((line, idx) => {
              const isPaid = line.status === "paid";
              const isExpired = line.status === "expired";
              const payUrl = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, "") + line.pay_link;

              return (
                <div key={line.id} className="p-4 sm:p-6 transition-colors hover:bg-muted/30 flex flex-col md:flex-row md:items-center gap-4 md:gap-6 animate-in fade-in" style={{ animationDelay: `${idx * 100}ms` }}>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="font-semibold text-lg truncate">{line.payer_name}</h3>
                      <Badge variant={isPaid ? "default" : isExpired ? "destructive" : "outline"} className={isPaid ? "bg-green-600 hover:bg-green-700" : ""}>
                        {line.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground truncate mb-2">{line.payer_email}</p>
                    
                    <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                      <span className="font-mono font-medium text-foreground bg-secondary/50 px-2 py-0.5 rounded">
                        {formatMoney(line.amount_major, order.currency)}
                      </span>
                      {line.apartment_type && (
                        <span className="text-muted-foreground">
                          {line.apartment_type === "one_bedroom" ? "1 Bed" : "2 Bed"} &times; {line.nights} nights
                        </span>
                      )}
                    </div>

                    {(line.voucher_code || line.credit_code) && (
                      <div className="mt-3 pt-3 border-t border-border/50">
                        {line.voucher_code && (
                          <div className="text-sm font-medium">
                            <span className="text-muted-foreground mr-2">Voucher:</span>
                            <span className="font-mono tracking-wider bg-primary/10 text-primary px-2 py-0.5 rounded">{line.voucher_code}</span>
                          </div>
                        )}
                        {line.credit_code && (
                          <div className="text-sm font-medium">
                            <span className="text-muted-foreground mr-2">Store Credit:</span>
                            <span className="font-mono tracking-wider bg-accent/10 text-accent px-2 py-0.5 rounded">{line.credit_code}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {!isPaid && !isExpired && (
                    <div className="flex flex-wrap items-center gap-2 shrink-0 pt-4 md:pt-0 border-t md:border-none border-border/50">
                      <Button
                        asChild
                        size="sm"
                      >
                        <a href={payUrl}>
                          <CreditCard className="w-4 h-4 mr-2" /> Pay
                        </a>
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => copyToClipboard(payUrl)}
                      >
                        {copiedLink === payUrl ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                        {copiedLink === payUrl ? "Copied" : "Link"}
                      </Button>
                      <Button 
                        variant="secondary" 
                        size="sm"
                        onClick={() => handleResend(line.id, line.payer_email)}
                        disabled={resend.isPending}
                      >
                        <Mail className="w-4 h-4 mr-2" /> Remind
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Layout>
  );
}
