export function BrandMark({ className = "brand-symbol" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 64 64" role="img" aria-label="ApiVoy"><path fill="currentColor" d="M9 10.5 55 30 34.8 36.8 28 57 9 10.5Zm11.6 10.4 8.2 20.2 3.7-11.4 11.3-3.8-23.2-5Z"/><circle cx="49" cy="13" r="5" fill="#43D7C0"/><circle cx="53" cy="48" r="4" fill="#43D7C0"/><path d="M45.5 16.5 37 25m11.5 19.5-10-9" fill="none" stroke="#43D7C0" strokeWidth="3" strokeLinecap="round"/></svg>;
}
