import { useEffect, useRef } from "react";
import { Switch, Route, Redirect, useLocation, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
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
import AdminVouchers from "@/pages/admin/vouchers";
import AdminPricing from "@/pages/admin/pricing";
import AdminGallery from "@/pages/admin/gallery";
import AdminWhatsappAudiences from "@/pages/admin/whatsapp-audiences";
import AdminWhatsappCampaigns from "@/pages/admin/whatsapp-campaigns";
import { AdminInbox } from "@/pages/admin/inbox";

const queryClient = new QueryClient();

// REQUIRED — copy verbatim. Resolves the key from window.location.hostname so the
// same build serves multiple Clerk custom domains.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// REQUIRED — copy verbatim. Empty in dev, auto-set in prod. Do NOT gate on env.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

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

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/seaboards-logo.jpg`,
  },
  variables: {
    colorPrimary: "hsl(215 51% 25%)",
    colorForeground: "hsl(213 13% 19%)",
    colorMutedForeground: "hsl(220 9% 46%)",
    colorDanger: "hsl(0 70% 50%)",
    colorBackground: "hsl(0 0% 100%)",
    colorInput: "hsl(0 0% 100%)",
    colorInputForeground: "hsl(213 13% 19%)",
    colorNeutral: "hsl(38 23% 87%)",
    fontFamily: "Inter, sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox:
      "bg-white border border-[#E4E0D8] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-[#2A2E35] text-xl font-semibold",
    headerSubtitle: "text-[#6B7280]",
    socialButtonsBlockButtonText: "text-[#2A2E35] font-medium",
    formFieldLabel: "text-[#2A2E35] font-medium",
    footerActionLink: "text-[#1F3A5F] font-semibold hover:text-[#B8860B]",
    footerActionText: "text-[#6B7280]",
    dividerText: "text-[#6B7280]",
    identityPreviewEditButton: "text-[#1F3A5F]",
    formFieldSuccessText: "text-[#1F3A5F]",
    alertText: "text-[#2A2E35]",
    logoBox: "h-12 flex justify-center",
    logoImage: "h-12 w-auto",
    socialButtonsBlockButton:
      "border border-[#E4E0D8] hover:bg-[#F8F6F1]",
    formButtonPrimary:
      "bg-[#1F3A5F] hover:bg-[#1F3A5F]/90 text-white font-semibold",
    formFieldInput:
      "border border-[#E4E0D8] bg-white text-[#2A2E35]",
    footerAction: "text-[#6B7280]",
    dividerLine: "bg-[#E4E0D8]",
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
      proxyUrl={clerkProxyUrl}
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
