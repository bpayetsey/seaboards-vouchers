import { useState, useMemo } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { CalendarIcon, Plus, Trash2, Link as LinkIcon, Check, Copy, ArrowRight } from "lucide-react";
import {
  useGetRates,
  useCreateGroupOrder,
  useGetStorefrontConfig,
} from "@workspace/api-client-react";
import type { GroupOrderInputMode, LineInputApartmentType, SplitConfigApartmentType } from "@workspace/api-client-react";

import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { formatMoney } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";

const independentLineSchema = z.object({
  payer_name: z.string().min(1, "Name is required"),
  payer_email: z.string().email("Invalid email"),
  apartment_type: z.enum(["one_bedroom", "two_bedroom"] as const),
  nights: z.coerce.number().min(1, "Must be at least 1 night"),
});

const splitLineSchema = z.object({
  payer_name: z.string().min(1, "Name is required"),
  payer_email: z.string().email("Invalid email"),
  share_major: z.coerce.number().min(1, "Share must be greater than 0").optional(),
});

const formSchema = z.object({
  mode: z.enum(["independent", "split"] as const),
  organiser_name: z.string().min(1, "Name is required"),
  organiser_email: z.string().email("Invalid email"),
  organiser_phone: z
    .string()
    .min(1, "Mobile number is required")
    .regex(
      /^\+?[0-9][0-9\s\-()]{5,}$/,
      "Enter a valid mobile number including the country code (e.g. +248 2 510 000)",
    ),
  due_by: z.date().optional(),
  split: z.object({
    apartment_type: z.enum(["one_bedroom", "two_bedroom"] as const),
    nights: z.coerce.number().min(1),
  }).optional(),
  independent_lines: z.array(independentLineSchema).optional(),
  split_lines: z.array(splitLineSchema).optional(),
}).refine((data) => {
  if (data.mode === "split" && !data.split) return false;
  return true;
}, { message: "Split details required for split mode", path: ["split"] });

export default function GroupOrder() {
  const { toast } = useToast();
  const { data: rates, isLoading: ratesLoading } = useGetRates();
  const { data: config } = useGetStorefrontConfig();
  const createOrder = useCreateGroupOrder();
  
  const [createdResult, setCreatedResult] = useState<any>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  const form = useForm<z.input<typeof formSchema>, unknown, z.output<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      mode: "independent",
      organiser_name: "",
      organiser_email: "",
      organiser_phone: "",
      independent_lines: [
        { payer_name: "", payer_email: "", apartment_type: "one_bedroom", nights: 1 }
      ],
      split_lines: [
        { payer_name: "", payer_email: "" },
        { payer_name: "", payer_email: "" }
      ],
      split: {
        apartment_type: "one_bedroom",
        nights: 1
      }
    }
  });

  const mode = form.watch("mode");
  const splitConfig = form.watch("split");

  const independentLinesArray = useFieldArray({ control: form.control, name: "independent_lines" });
  const splitLinesArray = useFieldArray({ control: form.control, name: "split_lines" });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    if (!rates) return;
    
    let lines: any[] = [];
    
    if (values.mode === "independent") {
      lines = values.independent_lines?.map(line => ({
        payer_name: line.payer_name,
        payer_email: line.payer_email,
        apartment_type: line.apartment_type as LineInputApartmentType,
        nights: line.nights
      })) || [];
    } else {
      // Split mode logic - auto calculate equal shares if not specified
      if (!values.split) return;
      
      const totalNights = values.split.nights;
      const ratePerNight = values.split.apartment_type === "one_bedroom" ? rates.rates.one_bedroom : rates.rates.two_bedroom;
      const totalCostMajor = totalNights * ratePerNight;
      const totalCostMinor = totalCostMajor * rates.minor_per_major;
      
      const linesData = values.split_lines || [];
      const linesWithShares = linesData.filter(l => l.share_major && l.share_major > 0);
      const linesWithoutShares = linesData.filter(l => !l.share_major);
      
      const allocatedMajor = linesWithShares.reduce((sum, l) => sum + (l.share_major || 0), 0);
      const allocatedMinor = allocatedMajor * rates.minor_per_major;
      
      const remainingMinor = totalCostMinor - allocatedMinor;
      
      if (remainingMinor < 0) {
        toast({
          title: "Invalid shares",
          description: "Total allocated shares exceed the total cost.",
          variant: "destructive"
        });
        return;
      }
      
      let equalShareMinor = 0;
      let remainderMinor = 0;
      
      if (linesWithoutShares.length > 0) {
        equalShareMinor = Math.floor(remainingMinor / linesWithoutShares.length);
        remainderMinor = remainingMinor % linesWithoutShares.length;
      } else if (remainingMinor > 0) {
         toast({
          title: "Invalid shares",
          description: "Total allocated shares do not cover the full cost.",
          variant: "destructive"
        });
        return;
      }

      let remainderGiven = 0;
      
      lines = linesData.map(line => {
        let share_minor = 0;
        if (line.share_major && line.share_major > 0) {
          share_minor = line.share_major * rates.minor_per_major;
        } else {
          share_minor = equalShareMinor;
          if (remainderGiven < remainderMinor) {
            share_minor += 1;
            remainderGiven += 1;
          }
        }
        return {
          payer_name: line.payer_name,
          payer_email: line.payer_email,
          share_minor
        };
      });
    }

    createOrder.mutate({
      data: {
        mode: values.mode as GroupOrderInputMode,
        organiser_name: values.organiser_name,
        organiser_email: values.organiser_email,
        organiser_phone: values.organiser_phone.trim(),
        due_by: values.due_by ? values.due_by.toISOString() : undefined,
        split: values.mode === "split" && values.split ? {
          apartment_type: values.split.apartment_type as SplitConfigApartmentType,
          nights: values.split.nights
        } : undefined,
        lines
      }
    }, {
      onSuccess: (data) => {
        setCreatedResult(data);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
      onError: (err: any) => {
        toast({
          title: "Failed to create order",
          description: err.error || "An unexpected error occurred.",
          variant: "destructive"
        });
      }
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedLink(text);
    setTimeout(() => setCopiedLink(null), 2000);
    toast({
      title: "Copied to clipboard",
      description: "The link has been copied."
    });
  };

  if (createdResult) {
    const statusUrl = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, "") + createdResult.organiser_url;
    
    return (
      <Layout>
        <div className="container max-w-3xl mx-auto py-12 px-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-6">
              <Check className="w-8 h-8" />
            </div>
            <h1 className="text-4xl font-serif mb-4">Your group order is ready</h1>
            <p className="text-lg text-muted-foreground">
              We've generated payment links for everyone in your group.
            </p>
          </div>

          <Card className="mb-8 border-primary/20 shadow-md">
            <CardHeader className="bg-primary/5 pb-4">
              <CardTitle className="flex items-center gap-2">
                <LinkIcon className="w-5 h-5 text-primary" />
                Organiser Dashboard
              </CardTitle>
              <CardDescription>
                Save this link to check who has paid and access the final vouchers.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 bg-muted/50 p-3 rounded-md border border-border">
                <Input readOnly value={statusUrl} className="bg-transparent border-none font-mono text-sm focus-visible:ring-0" />
                <Button 
                  variant="secondary" 
                  onClick={() => copyToClipboard(statusUrl)}
                  className="shrink-0"
                >
                  {copiedLink === statusUrl ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                  {copiedLink === statusUrl ? "Copied" : "Copy Link"}
                </Button>
                <Button asChild>
                  <a href={statusUrl}>View Dashboard <ArrowRight className="w-4 h-4 ml-2" /></a>
                </Button>
              </div>
            </CardContent>
          </Card>

          <h2 className="text-2xl font-serif mb-6 border-b pb-2">Participant Payment Links</h2>
          <div className="space-y-4">
            {createdResult.lines.map((line: any, index: number) => {
              const payUrl = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, "") + line.pay_link;
              return (
                <Card key={line.id} className="overflow-hidden animate-in fade-in slide-in-from-bottom-2" style={{ animationDelay: `${index * 100}ms`, animationFillMode: 'both' }}>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between p-5 gap-4">
                    <div>
                      <h3 className="font-medium text-lg">{line.payer_name}</h3>
                      <p className="text-sm text-muted-foreground mb-1">{line.payer_email}</p>
                      {rates && (
                        <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold font-mono bg-secondary text-secondary-foreground">
                          {formatMoney(line.amount_minor / rates.minor_per_major, rates.currency)}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => copyToClipboard(payUrl)}
                      >
                        {copiedLink === payUrl ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                        {copiedLink === payUrl ? "Copied" : "Copy Payment Link"}
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <header className="text-center px-6 pt-12 pb-8 border-b-2 border-accent max-w-3xl mx-auto">
        <div className="font-sans text-xs font-bold uppercase tracking-[0.32em] text-primary">
          The Seaboards Apartments &middot; Anse La Mouche &middot; Mahe
        </div>
        <h1 className="font-serif text-primary text-4xl md:text-5xl mt-4 mb-1">
          Golden Jubilee Stay Offer
        </h1>
      </header>

      <div className="container max-w-3xl mx-auto px-6 pt-8 pb-24">
        <h2 className="font-serif text-primary text-2xl mb-3">The offer</h2>
        <div className="grid sm:grid-cols-2 gap-3.5">
          <div className="rounded-xl border border-border p-[18px]">
            <div className="font-bold text-primary">One-Bedroom &middot; 2 adults &middot; Half Board</div>
            <div className="mt-1">
              <span className="text-muted-foreground line-through text-sm">SCR 3,285</span>
            </div>
            <div className="text-[26px] font-extrabold text-primary leading-tight">
              SCR 2,300 <span className="text-[13px] font-normal text-muted-foreground">/night</span>
            </div>
            <span className="inline-block mt-1.5 rounded-full bg-secondary text-secondary-foreground font-bold text-xs px-2.5 py-0.5">
              Save ~30%
            </span>
          </div>
          <div className="rounded-xl border border-border p-[18px]">
            <div className="font-bold text-primary">Two-Bedroom &middot; 4 guests &middot; Half Board</div>
            <div className="mt-1">
              <span className="text-muted-foreground line-through text-sm">SCR 5,520</span>
            </div>
            <div className="text-[26px] font-extrabold text-primary leading-tight">
              SCR 3,750 <span className="text-[13px] font-normal text-muted-foreground">/night</span>
            </div>
            <span className="inline-block mt-1.5 rounded-full bg-secondary text-secondary-foreground font-bold text-xs px-2.5 py-0.5">
              Save ~32%
            </span>
          </div>
        </div>

        <ul className="list-none p-0 mt-2.5 space-y-1.5">
          {[
            "Children stay free — breakfast supplement SCR 295/day",
            "Pay in full, or spread over three monthly instalments",
            "First 50 vouchers: a cocktail or mocktail per adult with dinner",
          ].map((feat) => (
            <li key={feat} className="relative pl-[22px] text-[15px]">
              <Check className="absolute left-0 top-1 w-3.5 h-3.5 text-accent" strokeWidth={3} />
              {feat}
            </li>
          ))}
        </ul>
        {config?.promo_banner?.trim() && (
          <p className="text-[12.5px] text-muted-foreground mt-2">
            {config.promo_banner} Full{" "}
            <Link href="/terms" className="text-primary underline underline-offset-2">
              Terms &amp; Conditions
            </Link>
            .
          </p>
        )}

        <h2 className="font-serif text-primary text-2xl mt-8 mb-1">Buy as a group — one link each</h2>
        <p className="text-muted-foreground mt-0 mb-6">
          Set up a group and each person gets their own payment link.
        </p>

        {ratesLoading ? (
          <div className="space-y-8">
            <Skeleton className="h-12 w-3/4" />
            <Skeleton className="h-[400px] w-full" />
          </div>
        ) : (
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-10">
            
            <div className="grid md:grid-cols-2 gap-8">
              <Card className="shadow-sm border-border/50">
                <CardHeader>
                  <CardTitle>Organiser Details</CardTitle>
                  <CardDescription>Who is setting this up?</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="organiser_name">Full Name</Label>
                    <Input id="organiser_name" {...form.register("organiser_name")} placeholder="Jane Doe" />
                    {form.formState.errors.organiser_name && (
                      <p className="text-sm text-destructive">{form.formState.errors.organiser_name.message}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="organiser_email">Email Address</Label>
                    <Input id="organiser_email" type="email" {...form.register("organiser_email")} placeholder="jane@example.com" />
                    {form.formState.errors.organiser_email && (
                      <p className="text-sm text-destructive">{form.formState.errors.organiser_email.message}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="organiser_phone">Mobile Number (WhatsApp)</Label>
                    <Input id="organiser_phone" type="tel" {...form.register("organiser_phone")} placeholder="+248 2 510 000" />
                    <p className="text-xs text-muted-foreground">
                      Include the country code — voucher confirmations are also sent on WhatsApp.
                    </p>
                    {form.formState.errors.organiser_phone && (
                      <p className="text-sm text-destructive">{form.formState.errors.organiser_phone.message}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Payment Deadline (Optional)</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant={"outline"}
                          className={`w-full justify-start text-left font-normal ${!form.watch("due_by") && "text-muted-foreground"}`}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {form.watch("due_by") ? format(form.watch("due_by")!, "PPP") : <span>Select a date</span>}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={form.watch("due_by")}
                          onSelect={(date) => form.setValue("due_by", date)}
                          initialFocus
                          disabled={(date) => date < new Date()}
                        />
                      </PopoverContent>
                    </Popover>
                    <p className="text-xs text-muted-foreground">Unpaid links expire after this date.</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-sm border-border/50">
                <CardHeader>
                  <CardTitle>Voucher Type</CardTitle>
                  <CardDescription>How would you like to structure the gift?</CardDescription>
                </CardHeader>
                <CardContent>
                  <RadioGroup 
                    onValueChange={(val) => form.setValue("mode", val as any)} 
                    defaultValue={mode}
                    className="grid gap-4"
                  >
                    <div>
                      <RadioGroupItem value="independent" id="independent" className="peer sr-only" />
                      <Label
                        htmlFor="independent"
                        className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-transparent p-4 hover:bg-accent/5 hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 [&:has([data-state=checked])]:border-primary cursor-pointer transition-all"
                      >
                        <span className="font-semibold text-base mb-1">Independent Vouchers</span>
                        <span className="text-sm text-center text-muted-foreground font-normal">Each person buys a separate voucher for themselves.</span>
                      </Label>
                    </div>
                    <div>
                      <RadioGroupItem value="split" id="split" className="peer sr-only" />
                      <Label
                        htmlFor="split"
                        className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-transparent p-4 hover:bg-accent/5 hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 [&:has([data-state=checked])]:border-primary cursor-pointer transition-all"
                      >
                        <span className="font-semibold text-base mb-1">Split a Shared Voucher</span>
                        <span className="text-sm text-center text-muted-foreground font-normal">One big voucher for everyone, split equally or by custom amounts.</span>
                      </Label>
                    </div>
                  </RadioGroup>
                </CardContent>
              </Card>
            </div>

            {mode === "split" && (
              <Card className="shadow-sm border-primary/20 bg-primary/5">
                <CardHeader>
                  <CardTitle>Shared Accommodation</CardTitle>
                  <CardDescription>What are you booking together?</CardDescription>
                </CardHeader>
                <CardContent className="grid sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>Apartment Type</Label>
                    <Select 
                      onValueChange={(val) => form.setValue("split.apartment_type", val as any)}
                      defaultValue={splitConfig?.apartment_type || "one_bedroom"}
                    >
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="one_bedroom">One Bedroom ({rates && formatMoney(rates.rates.one_bedroom, rates.currency)} / night)</SelectItem>
                        <SelectItem value="two_bedroom">Two Bedroom ({rates && formatMoney(rates.rates.two_bedroom, rates.currency)} / night)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Number of Nights</Label>
                    <Input 
                      type="number" 
                      min="1" 
                      className="bg-background"
                      {...form.register("split.nights")} 
                    />
                  </div>
                </CardContent>
                <CardFooter className="bg-background/50 border-t py-4 px-6 justify-between flex-wrap gap-4">
                  <span className="text-sm text-muted-foreground">Total Value:</span>
                  <span className="text-2xl font-serif font-semibold text-primary">
                    {rates && splitConfig ? formatMoney(
                      (splitConfig.apartment_type === "one_bedroom" ? rates.rates.one_bedroom : rates.rates.two_bedroom) * splitConfig.nights, 
                      rates.currency
                    ) : "-"}
                  </span>
                </CardFooter>
              </Card>
            )}

            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-2xl font-serif">Participants</h3>
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm" 
                  onClick={() => {
                    if (mode === "independent") {
                      independentLinesArray.append({ payer_name: "", payer_email: "", apartment_type: "one_bedroom", nights: 1 });
                    } else {
                      splitLinesArray.append({ payer_name: "", payer_email: "" });
                    }
                  }}
                >
                  <Plus className="w-4 h-4 mr-2" /> Add Person
                </Button>
              </div>

              {mode === "independent" ? (
                <div className="space-y-4">
                  {independentLinesArray.fields.map((field, index) => (
                    <Card key={field.id} className="relative overflow-hidden group">
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary/40 group-hover:bg-primary transition-colors"></div>
                      <CardContent className="p-6">
                        <div className="flex justify-between items-start mb-4">
                          <h4 className="font-medium text-muted-foreground text-sm uppercase tracking-wider">Participant {index + 1}</h4>
                          {index > 0 && (
                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10" onClick={() => independentLinesArray.remove(index)}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                          <div className="space-y-2">
                            <Label>Name</Label>
                            <Input {...form.register(`independent_lines.${index}.payer_name`)} placeholder="Name" />
                          </div>
                          <div className="space-y-2">
                            <Label>Email</Label>
                            <Input type="email" {...form.register(`independent_lines.${index}.payer_email`)} placeholder="Email" />
                          </div>
                          <div className="space-y-2">
                            <Label>Type</Label>
                            <Select 
                              onValueChange={(val) => form.setValue(`independent_lines.${index}.apartment_type`, val as any)}
                              defaultValue={field.apartment_type}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="one_bedroom">1 Bed</SelectItem>
                                <SelectItem value="two_bedroom">2 Bed</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>Nights</Label>
                            <Input type="number" min="1" {...form.register(`independent_lines.${index}.nights`)} />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="space-y-4">
                  {splitLinesArray.fields.map((field, index) => (
                    <Card key={field.id} className="relative overflow-hidden group">
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary/40 group-hover:bg-primary transition-colors"></div>
                      <CardContent className="p-6">
                        <div className="flex justify-between items-start mb-4">
                          <h4 className="font-medium text-muted-foreground text-sm uppercase tracking-wider">Participant {index + 1}</h4>
                          {index > 1 && (
                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10" onClick={() => splitLinesArray.remove(index)}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                        <div className="grid sm:grid-cols-3 gap-4">
                          <div className="space-y-2">
                            <Label>Name</Label>
                            <Input {...form.register(`split_lines.${index}.payer_name`)} placeholder="Name" />
                          </div>
                          <div className="space-y-2">
                            <Label>Email</Label>
                            <Input type="email" {...form.register(`split_lines.${index}.payer_email`)} placeholder="Email" />
                          </div>
                          <div className="space-y-2">
                            <Label>Specific Share (Optional)</Label>
                            <div className="relative">
                              <span className="absolute left-3 top-2.5 text-muted-foreground font-mono text-sm">{rates?.currency}</span>
                              <Input type="number" min="0" step="any" className="pl-12 font-mono" placeholder="Leave empty for equal split" {...form.register(`split_lines.${index}.share_major`)} />
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  <p className="text-sm text-muted-foreground flex items-center bg-muted/50 p-3 rounded-md border border-border">
                    <Check className="w-4 h-4 mr-2 text-primary" />
                    If you leave specific shares blank, the remaining cost will be split equally among them.
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-8 border-t border-border">
              <Button type="submit" size="lg" className="w-full sm:w-auto text-lg h-14 px-8" disabled={createOrder.isPending}>
                {createOrder.isPending ? "Generating Links..." : "Create Group Order"}
                {!createOrder.isPending && <ArrowRight className="w-5 h-5 ml-2" />}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Layout>
  );
}
