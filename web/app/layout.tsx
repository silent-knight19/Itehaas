import "./globals.css";
import Link from "next/link";

export const metadata = {
  title: "Itehaas — Git from scratch",
  description: "Self-hosted Git-inspired VCS + platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col antialiased">
        <header className="border-b bg-white/80 backdrop-blur sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
            <Link href="/" className="font-bold text-xl tracking-tight">
              <span className="text-brand-600">Itehaas</span>
              <span className="text-gray-500 font-normal ml-2 text-sm">v0.1 • Phase 7</span>
            </Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/" className="hover:text-brand-600">Dashboard</Link>
              <Link href="/login" className="hover:text-brand-600">Login</Link>
              <Link href="/register" className="hover:text-brand-600">Register</Link>
              <a href="http://localhost:3001/health" target="_blank" className="text-gray-400">API</a>
            </nav>
          </div>
        </header>
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">{children}</main>
        <footer className="border-t text-xs text-gray-500 py-4 text-center">
          Itehaas • Rust + Fastify + Next.js • {new Date().getFullYear()}
        </footer>
      </body>
    </html>
  );
}
