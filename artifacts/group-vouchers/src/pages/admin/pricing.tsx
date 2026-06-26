import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAdminCatalogPrices,
  useUpdateCatalogPrice,
  getGetAdminCatalogPricesQueryKey,
  getGetStorefrontConfigQueryKey,
  getGetRatesQueryKey,
} from "@workspace/api-client-react";
import type { AdminCatalogPriceItem } from "@workspace/api-client-react";
import { AdminShell } from "./AdminShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Tag } from "lucide-react";

function PriceCard({
  item,
  currency,
  symbol,
  onSaved,
}: {
  item: AdminCatalogPriceItem;
  currency: string;
  symbol: string;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const update = useUpdateCatalogPrice();
  const [rate, setRate] = useState(String(item.rate));
  const [was, setWas] = useState(String(item.was));

  const dirty =
    rate !== String(item.rate) || was !== String(item.was);

  const save = () => {
    const rateNum = Number(rate);
    const wasNum = Number(was);
    if (!Number.isFinite(rateNum) || rateNum <= 0) {
      toast({
        title: "Enter a valid price",
        description: "The per-night price must be a positive number.",
        variant: "destructive",
      });
      return;
    }
    if (!Number.isFinite(wasNum) || wasNum < 0) {
      toast({
        title: "Enter a valid original price",
        description: "The original price can't be negative.",
        variant: "destructive",
      });
      return;
    }
    update.mutate(
      { itemId: item.id, data: { rate: rateNum, was: wasNum } },
      {
        onSuccess: () => {
          onSaved();
          toast({ title: `${item.name} price updated` });
        },
        onError: () =>
          toast({
            title: "Could not save the price",
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle className="font-serif text-primary">{item.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label
              htmlFor={`rate-${item.id}`}
              className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
            >
              Price per night ({currency.toUpperCase()})
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{symbol}</span>
              <Input
                id={`rate-${item.id}`}
                type="number"
                min={1}
                step={1}
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor={`was-${item.id}`}
              className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
            >
              Original price (struck through)
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{symbol}</span>
              <Input
                id={`was-${item.id}`}
                type="number"
                min={0}
                step={1}
                value={was}
                onChange={(e) => setWas(e.target.value)}
              />
            </div>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Shown on the storefront and used to price both direct and group
          orders. Minimum stay: {item.min_nights} night
          {item.min_nights === 1 ? "" : "s"}.
        </p>
        <div className="flex justify-end">
          <Button onClick={save} disabled={!dirty || update.isPending}>
            {update.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Save price
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminPricing() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useGetAdminCatalogPrices();

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: getGetAdminCatalogPricesQueryKey(),
    });
    queryClient.invalidateQueries({
      queryKey: getGetStorefrontConfigQueryKey(),
    });
    queryClient.invalidateQueries({ queryKey: getGetRatesQueryKey() });
  };

  return (
    <AdminShell
      title="Voucher Pricing"
      subtitle="Set the per-night prices for each apartment voucher. Changes apply immediately to the storefront and to group orders."
    >
      {isLoading ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Spinner className="h-8 w-8 text-primary" />
        </div>
      ) : isError || !data ? (
        <p className="text-sm text-destructive">Could not load prices.</p>
      ) : data.items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <Tag className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No editable vouchers found.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {data.items.map((item) => (
            <PriceCard
              key={item.id}
              item={item}
              currency={data.currency}
              symbol={data.symbol}
              onSaved={invalidate}
            />
          ))}
        </div>
      )}
    </AdminShell>
  );
}
