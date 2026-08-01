import Link from "next/link";

const links = [
  { href: "/", label: "Individual" },
  { href: "/aggregate", label: "Aggregate" },
  { href: "/dashboard", label: "Dashboard" },
];

export function Nav() {
  return (
    <header className="border-b border-[#3a3b3f] bg-[#16171a]">
      <div className="mx-auto flex w-full max-w-[1920px] items-center justify-between gap-4 px-4 py-3 xl:px-6">
        <Link href="/" className="text-sm font-semibold tracking-tight text-white">
          Photomolecular Lab · Chamber Sensors
        </Link>
        <nav className="flex gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded px-3 py-1.5 text-sm text-[#b5b5b8] hover:bg-[#2a2b2e] hover:text-white"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
