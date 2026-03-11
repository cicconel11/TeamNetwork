import Link from "next/link";
import Image from "next/image";

interface AuthHeaderProps {
  subtitle: string;
}

export function AuthHeader({ subtitle }: AuthHeaderProps) {
  const heading = subtitle;

  return (
    <div className="text-center mb-8">
      <h1 className="sr-only">{heading}</h1>
      <Link href="/" className="inline-block">
        <Image
          src="/TeamNetwor.png"
          alt="TeamNetwork"
          width={541}
          height={303}
          className="h-32 w-auto object-contain mx-auto"
          priority
        />
      </Link>
      {subtitle && <p className="text-white/50 mt-3">{subtitle}</p>}
    </div>
  );
}
