import { Link } from "wouter";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-primary selection:text-primary-foreground">
      <header className="w-full border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <Link
            href="/"
            className="font-sans text-[11px] font-bold uppercase tracking-[0.32em] text-primary transition-opacity hover:opacity-80"
          >
            The Seaboards Apartments
          </Link>
          <Link
            href="/terms"
            className="font-sans text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground transition-colors hover:text-primary"
          >
            Terms
          </Link>
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
