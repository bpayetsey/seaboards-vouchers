import { useEffect, useRef } from "react";
import { Switch, Route, Redirect, useLocation, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { shadcn } from "@clerk/themes";
import { useGetAdminMe, trackPageView } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Home from "@/pages/home";
import GroupOrder from "@/pages/group-order";
import GroupDashboard from "@/pages/group";
import PayLine from "@/pages/pay";
import PayDone from "@/pages/pay-done";
import Terms from "@/pages/terms";
import Menu from "@/pages/menu";
import Dashboard from "@/pages/dashboard";
import AdminOverview from "@/pages/admin/overview";
import AdminOrders from "@/pages/admin/orders";
import AdminGroupOrders from "@/pages/admin/group-orders";
import AdminCalendar from "@/pages/admin/calendar";
import AdminVouchers from "@/pages/admin/vouchers";
import AdminPricing from "@/pages/admin/pricing";
import AdminSiteContent from "@/pages/admin/site-content";
import AdminGallery from "@/pages/admin/gallery";
import AdminWhatsappAudiences from "@/pages/admin/whatsapp-audiences";
import AdminWhatsappCampaigns from "@/pages/admin/whatsapp-campaigns";
import { AdminInbox } from "@/pages/admin/inbox";
import AdminEmailAudiences from "@/pages/admin/email-audiences";
import AdminEmailCampaigns from "@/pages/admin/email-campaigns";

const queryClient = new QueryClient();

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

// Clerk passes full paths to routerPush/routerReplace, but wouter's
// setLocation prepends the base — strip it to avoid doubling.
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

// Sign-in / sign-up cards in theseaboards.com's look: ivory, deep green, gold,
// Cormorant Garamond headings, Jost text, square corners.
const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/seaboards-logo-gold.png`,
  },
  variables: {
    colorPrimary: "hsl(154 25% 18%)",
    colorForeground: "hsl(153 13% 13%)",
    colorMutedForeground: "hsl(150 6% 38%)",
    colorDanger: "hsl(8 55% 39%)",
    colorBackground: "hsl(43 45% 97%)",
    colorInput: "hsl(0 0% 100%)",
    colorInputForeground: "hsl(153 13% 13%)",
    colorNeutral: "hsl(40 19% 82%)",
    fontFamily: "Jost, 'Helvetica Neue', Arial, sans-serif",
    borderRadius: "0rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox:
      "bg-[#FBF9F4] border border-[#DCD5C6] w-[440px] max-w-full overflow-hidden shadow-xl",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "font-serif text-[#1D2622] text-3xl font-medium",
    headerSubtitle: "text-[#5A6660]",
    socialButtonsBlockButtonText: "text-[#1D2622] font-medium",
    formFieldLabel: "text-[#1D2622] font-medium",
    footerActionLink: "text-[#22392F] font-semibold hover:text-[#8A6D40]",
    footerActionText: "text-[#5A6660]",
    dividerText: "text-[#5A6660]",
    identityPreviewEditButton: "text-[#22392F]",
    formFieldSuccessText: "text-[#22392F]",
    alertText: "text-[#1D2622]",
    logoBox: "h-12 flex justify-center",
    logoImage: "h-12 w-auto",
    socialButtonsBlockButton:
      "border border-[#DCD5C6] hover:bg-[#F5F1E8]",
    formButtonPrimary:
      "bg-[#22392F] hover:bg-[#2E4B40] text-[#F5F1E8] font-medium uppercase tracking-[0.16em] text-[0.72rem]",
    formFieldInput:
      "border border-[#DCD5C6] bg-white text-[#1D2622]",
    footerAction: "text-[#5A6660]",
    dividerLine: "bg-[#DCD5C6]",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        fallbackRedirectUrl={`${basePath}/post-login`}
      />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        fallbackRedirectUrl={`${basePath}/post-login`}
      />
    </div>
  );
}

function ProtectedDashboard() {
  return (
    <>
      <Show when="signed-in">
        <Dashboard />
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

// Post-login landing: checks staff status via /admin/me and routes staff to the
// admin dashboard, everyone else to their client account dashboard.
function PostLoginRedirect() {
  const { data, isLoading, isError } = useGetAdminMe();

  if (isLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isError && data?.staff) {
    return <Redirect to="/admin" />;
  }
  return <Redirect to="/dashboard" />;
}

function ProtectedPostLogin() {
  return (
    <>
      <Show when="signed-in">
        <PostLoginRedirect />
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

// Admin pages require a signed-in session; the AdminShell then verifies staff
// allow-list membership via /admin/me and redirects non-staff away.
function ProtectedAdmin({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Show when="signed-in">{children}</Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

// Invalidate the query cache when the signed-in user changes, so cached
// account data never leaks across sessions.
function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

// Fire-and-forget visitor beacon: records one page view per public route
// change. Admin routes are excluded so internal staff use never inflates the
// counts; failures are swallowed so tracking can never break the UI.
function PageViewTracker() {
  const [location] = useLocation();
  useEffect(() => {
    if (location.startsWith("/admin")) return;
    void trackPageView({ path: location }).catch(() => {});
  }, [location]);
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/group-order" component={GroupOrder} />
      <Route path="/terms" component={Terms} />
      <Route path="/menu" component={Menu} />
      <Route path="/group/:statusToken" component={GroupDashboard} />
      <Route path="/pay/:payToken" component={PayLine} />
      <Route path="/pay/:payToken/done" component={PayDone} />
      <Route path="/post-login" component={ProtectedPostLogin} />
      <Route path="/dashboard" component={ProtectedDashboard} />
      <Route path="/admin">
        <ProtectedAdmin>
          <AdminOverview />
        </ProtectedAdmin>
      </Route>
      <Route path="/admin/orders">
        <ProtectedAdmin>
          <AdminOrders />
        </ProtectedAdmin>
      </Route>
      <Route path="/admin/group-orders">
        <ProtectedAdmin>
          <AdminGroupOrders />
        </ProtectedAdmin>
      </Route>
      <Route path="/admin/calendar">
        <ProtectedAdmin>
          <AdminCalendar />
        </ProtectedAdmin>
      </Route>
      <Route path="/admin/vouchers">
        <ProtectedAdmin>
          <AdminVouchers />
        </ProtectedAdmin>
      </Route>
      <Route path="/admin/pricing">
        <ProtectedAdmin>
          <AdminPricing />
        </ProtectedAdmin>
      </Route>
      <Route path="/admin/site-content">
        <ProtectedAdmin>
          <AdminSiteContent />
        </ProtectedAdmin>
      </Route>
      <Route path="/admin/gallery">
        <ProtectedAdmin>
          <AdminGallery />
        </ProtectedAdmin>
      </Route>
      <Route path="/admin/whatsapp/audiences">
        <ProtectedAdmin>
          <AdminWhatsappAudiences />
        </ProtectedAdmin>
      </Route>
      <Route path="/admin/whatsapp/campaigns">
        <ProtectedAdmin>
          <AdminWhatsappCampaigns />
        </ProtectedAdmin>
      </Route>
      <Route path="/admin/inbox">
        <ProtectedAdmin>
          <AdminInbox />
        </ProtectedAdmin>
      </Route>
      <Route path="/admin/email/audiences">
        <ProtectedAdmin>
          <AdminEmailAudiences />
        </ProtectedAdmin>
      </Route>
      <Route path="/admin/email/campaigns">
        <ProtectedAdmin>
          <AdminEmailCampaigns />
        </ProtectedAdmin>
      </Route>
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in to view your vouchers, payments and receipts",
          },
        },
        signUp: {
          start: {
            title: "Create your account",
            subtitle: "Track your Seaboards vouchers, payments and receipts",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <PageViewTracker />
          <Router />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
