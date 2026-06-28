import { useState } from "react";
import { Link } from "wouter";
import { Show, useClerk } from "@clerk/react";
import { LayoutDashboard, LogOut, LogIn, Home, Menu } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "./ui/sheet";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const linkClass =
  "font-sans text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground transition-colors hover:text-primary";

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { signOut } = useClerk();

  return (
    <>
      <Link
        href="/"
        onClick={onNavigate}
        className={`flex items-center gap-1.5 ${linkClass}`}
      >
        <Home className="h-3.5 w-3.5" />
        Home
      </Link>
      <Link href="/menu" onClick={onNavigate} className={linkClass}>
        Menu
      </Link>
      <Link href="/terms" onClick={onNavigate} className={linkClass}>
        Terms
      </Link>
      <Show when="signed-in">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className={`flex items-center gap-1.5 ${linkClass}`}
        >
          <LayoutDashboard className="h-3.5 w-3.5" />
          My Account
        </Link>
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            signOut({ redirectUrl: basePath || "/" });
          }}
          className={`flex items-center gap-1.5 ${linkClass}`}
        >
          <LogOut className="h-3.5 w-3.5" />
          Log out
        </button>
      </Show>
      <Show when="signed-out">
        <Link
          href="/sign-in"
          onClick={onNavigate}
          className="flex items-center gap-1.5 font-sans text-[11px] font-semibold uppercase tracking-[0.22em] text-primary transition-opacity hover:opacity-80"
        >
          <LogIn className="h-3.5 w-3.5" />
          Sign in
        </Link>
      </Show>
    </>
  );
}

function AuthNav() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <nav className="hidden items-center gap-5 sm:flex">
        <NavLinks />
      </nav>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:text-primary sm:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </SheetTrigger>
        <SheetContent side="right" className="w-64">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <nav className="mt-8 flex flex-col gap-6">
            <NavLinks onNavigate={() => setOpen(false)} />
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-primary selection:text-primary-foreground">
      <header className="w-full border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <Link
            href="/"
            className="font-sans text-[11px] font-bold uppercase tracking-[0.32em] text-primary transition-opacity hover:opacity-80"
          >
            The Seaboards Apartments
          </Link>
          <AuthNav />
        </div>
      </header>
      <main className="flex-1 w-full relative">{children}</main>
      <footer className="border-t-2 border-accent/70 py-8 bg-card mt-auto">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p className="font-serif italic mb-2">
            Celebrating 50 Years of Seychelles Independence &middot; 1976&ndash;2026
          </p>
          <p className="font-sans text-xs tracking-[0.04em] text-primary">
            The Seaboards Apartments &middot; Anse La Mouche &middot; Mah&eacute; &middot; Seychelles
          </p>
        </div>
      </footer>
    </div>
  );
}
