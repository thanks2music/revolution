import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** class 名を結合し、Tailwind の衝突する指定は後の方を残す (shadcn/ui の作法) */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
