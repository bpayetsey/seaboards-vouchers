import { Layout } from "@/components/layout";
import { AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <Layout>
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-destructive mx-auto mb-4" />
          <h1 className="text-4xl font-serif font-bold text-foreground mb-4">Page Not Found</h1>
          <p className="text-lg text-muted-foreground mb-8">
            The page you are looking for doesn't exist or has been moved.
          </p>
          <Button asChild>
            <Link href="/">Return to Homepage</Link>
          </Button>
        </div>
      </div>
    </Layout>
  );
}
