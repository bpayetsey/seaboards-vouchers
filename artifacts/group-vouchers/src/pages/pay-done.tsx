import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useGetPayLine } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldCheck, Loader2, RefreshCw, Download } from "lucide-react";
import { getGetPayLineQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  downloadVoucherPdf,
  publicVoucherPdfUrl,
  voucherPdfFilename,
} from "@/lib/voucherPdf";

function DownloadVoucherButton({ code }: { code: string }) {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadVoucherPdf(
        publicVoucherPdfUrl(code),
        voucherPdfFilename(code),
      );
    } catch {
      toast({
        title: "Download failed",
        description: "We couldn't generate your voucher PDF. Please try again.",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Button
      variant="outline"
      className="w-full mt-4"
      disabled={downloading}
      onClick={handleDownload}
    >
      <Download className="w-4 h-4 mr-2" />
      {downloading ? "Preparing…" : "Download voucher (PDF)"}
    </Button>
  );
}

export default function PayDone() {
  const params = useParams();
  const payToken = params.payToken as string;
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [retryCount, setRetryCount] = useState(0);

  const { data: line, isLoading } = useGetPayLine(payToken, {
    query: {
      enabled: !!payToken,
      queryKey: getGetPayLineQueryKey(payToken),
      refetchInterval: (query) => {
        // Poll every 2 seconds if not paid yet, max 10 times
        if (query.state.data?.status !== "paid" && retryCount < 10) {
          return 2000;
        }
        return false;
      }
    }
  });

  // Track polling attempts
  useEffect(() => {
    if (line && line.status !== "paid" && retryCount < 10) {
      const timer = setTimeout(() => setRetryCount(r => r + 1), 2000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [line, retryCount]);

  const handleManualRefresh = () => {
    setRetryCount(0);
    queryClient.invalidateQueries({ queryKey: getGetPayLineQueryKey(payToken) });
  };

  if (isLoading || !line) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
          <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
          <h2 className="text-2xl font-serif text-foreground mb-2">Loading your payment details...</h2>
        </div>
      </Layout>
    );
  }

  const isPaid = line.status === "paid";

  return (
    <Layout>
      <div className="container mx-auto px-4 py-20 max-w-md text-center">
        {isPaid ? (
          <div className="animate-in zoom-in-95 duration-500">
            <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
              <ShieldCheck className="w-10 h-10" />
            </div>
            <h1 className="text-3xl font-serif text-foreground mb-2">Payment Successful!</h1>
            <p className="text-muted-foreground mb-6">Thank you, {line.payer_name}. Your payment has been confirmed.</p>

            {line.order_number && (
              <div className="mb-8 inline-flex flex-col items-center">
                <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Order number
                </span>
                <span className="mt-1 font-mono text-lg font-bold tracking-wider text-primary">
                  {line.order_number}
                </span>
              </div>
            )}
            
            {line.voucher_code && (
              <Card className="border-primary/20 bg-primary/5 shadow-sm">
                <CardContent className="pt-6">
                  <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground mb-3">Your Voucher Code</p>
                  <div className="text-3xl font-mono tracking-widest font-bold bg-background py-4 rounded-lg border border-border shadow-inner">
                    {line.voucher_code}
                  </div>
                  <p className="text-xs text-muted-foreground mt-4">Keep this code safe. You'll need it when booking.</p>
                  <DownloadVoucherButton code={line.voucher_code} />
                </CardContent>
              </Card>
            )}

            {!line.voucher_code && line.organiser_name && (
               <Card className="border-border shadow-sm">
                <CardContent className="pt-6">
                  <p className="text-foreground font-medium mb-2">Shared Voucher</p>
                  <p className="text-sm text-muted-foreground">
                    Your contribution is complete. The master voucher code will be provided to <strong>{line.organiser_name}</strong> once all participants have paid.
                  </p>
                </CardContent>
              </Card>
            )}

            <div className="mt-8 pt-6 border-t border-border/60">
              <p className="text-sm text-muted-foreground mb-3">
                Create an account or sign in to keep track of your vouchers,
                payments and receipts.
              </p>
              <Button variant="default" onClick={() => setLocation("/dashboard")}>
                Access your dashboard
              </Button>
            </div>

            <Button variant="outline" className="mt-6" onClick={() => setLocation(`/pay/${payToken}`)}>
              Return to Summary
            </Button>
          </div>
        ) : (
          <div className="animate-in fade-in duration-500">
            <div className="w-20 h-20 bg-secondary text-secondary-foreground rounded-full flex items-center justify-center mx-auto mb-6 relative">
              <Loader2 className="w-10 h-10 animate-spin absolute" />
            </div>
            <h1 className="text-2xl font-serif text-foreground mb-4">Processing Payment...</h1>
            <p className="text-muted-foreground mb-6">
              We're waiting for confirmation from Stripe. This usually takes just a few seconds.
            </p>
            
            {retryCount >= 10 && (
              <div className="bg-muted p-4 rounded-lg text-sm mb-6 text-left">
                <p className="font-medium mb-2">Taking longer than usual?</p>
                <p className="text-muted-foreground mb-4">If your payment went through on Stripe, it will be updated here shortly. You can refresh manually or return later.</p>
                <Button onClick={handleManualRefresh} variant="outline" className="w-full">
                  <RefreshCw className="w-4 h-4 mr-2" /> Check Status Again
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
