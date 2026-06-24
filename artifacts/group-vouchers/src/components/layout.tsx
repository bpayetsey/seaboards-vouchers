import { Link } from "wouter";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-primary selection:text-primary-foreground">
      <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-serif text-xl tracking-tight font-medium text-primary transition-opacity hover:opacity-80">
            Seaboards <span className="font-sans text-xs font-bold tracking-widest uppercase text-muted-foreground mt-1">Seychelles</span>
          </Link>
        </div>
      </header>
      <main className="flex-1 w-full relative">
        {children}
      </main>
      <footer className="border-t border-border/40 py-8 bg-card mt-auto">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p className="font-serif italic mb-2">Celebrating 50 Years of Seaboards</p>
          <p>&copy; {new Date().getFullYear()} Seaboards Resort Seychelles. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
