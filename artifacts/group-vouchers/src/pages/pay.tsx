import { useParams } from "wouter";
import { useGetPayLine, useCreateCheckout } from "@workspace/api-client-react";
import { formatMoney } from "@/lib/format";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, Lock, CreditCard, AlertCircle } from "lucide-react";
import { getGetPayLineQueryKey } from "@workspace/api-client-react";
import resortHero from "@/assets/resort-hero.jpg";

export default function PayLine() {
  const params = useParams();
  const payToken = params.payToken as string;
  
  const { data: line, isLoading, error } = useGetPayLine(payToken, {
    query: {
      enabled: !!payToken,
      queryKey: getGetPayLineQueryKey(payToken)
    }
  });

  const checkout = useCreateCheckout();

  const handleCheckout = () => {
    checkout.mutate({ payToken }, {
      onSuccess: (data) => {
        window.location.href = data.url;
      }
    });
  };

  if (error) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-20 max-w-md text-center">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h1 className="text-2xl font-serif font-bold text-foreground mb-2">Link Invalid</h1>
          <p className="text-muted-foreground">This payment link is invalid or has expired.</p>
        </div>
      </Layout>
    );
  }

  if (isLoading || !line) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-20 max-w-md space-y-6">
          <Skeleton className="h-12 w-3/4 mx-auto" />
          <Skeleton className="h-[400px] w-full rounded-xl" />
        </div>
      </Layout>
    );
  }

  if (line.status === "paid") {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-20 max-w-md text-center animate-in zoom-in-95 duration-500">
          <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <ShieldCheck className="w-10 h-10" />
          </div>
          <h1 className="text-3xl font-serif text-foreground mb-4">Payment Complete</h1>
          <p className="text-muted-foreground mb-8">Thank you, {line.payer_name}. Your share has been paid.</p>
          
          {line.voucher_code && (
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
              <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground mb-3">Your Voucher Code</p>
              <div className="text-2xl font-mono tracking-widest font-bold bg-muted/50 py-3 rounded-lg">
                {line.voucher_code}
              </div>
            </div>
          )}
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="min-h-[calc(100vh-140px)] flex flex-col justify-center items-center py-12 px-4 relative overflow-hidden">
        {/* Abstract Background element */}
        <div className="absolute top-0 w-full h-[40vh] z-0 opacity-20 pointer-events-none">
          <img src={resortHero} alt="" className="w-full h-full object-cover blur-sm" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background"></div>
        </div>

        <div className="w-full max-w-md relative z-10">
          <div className="text-center mb-8">
            <p className="text-sm font-medium uppercase tracking-widest text-primary mb-2">Secure Checkout</p>
            <h1 className="text-3xl md:text-4xl font-serif text-foreground mb-3">Hello, {line.payer_name}</h1>
            {line.organiser_name && (
              <p className="text-muted-foreground">
                You've been invited by <span className="font-medium text-foreground">{line.organiser_name}</span> to join a group voucher for Seaboards Resort.
              </p>
            )}
          </div>

          <Card className="shadow-xl border-border/50 overflow-hidden bg-background/95 backdrop-blur">
            <div className="bg-primary/5 p-6 border-b border-border/50 text-center">
              <p className="text-sm text-muted-foreground mb-2">Amount Due</p>
              <div className="text-4xl font-mono font-bold tracking-tight text-foreground">
                {formatMoney(line.amount_major, line.currency)}
              </div>
            </div>
            
            <CardContent className="p-6 space-y-6">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Description</h3>
                <p className="font-medium">{line.description}</p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 flex items-start gap-3">
                <Lock className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Payment is processed securely. Your card details are never stored on our servers.
                </p>
              </div>

              <Button 
                size="lg" 
                className="w-full text-lg h-14" 
                disabled={!line.payable || checkout.isPending}
                onClick={handleCheckout}
              >
                {checkout.isPending ? (
                  "Preparing checkout..."
                ) : (
                  <>
                    <CreditCard className="w-5 h-5 mr-2" />
                    Pay {formatMoney(line.amount_major, line.currency)}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
