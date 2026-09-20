// Concerto's mark. Four points, concave sides, no hard corners.
export function Star({ className = "star" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M12 1.5Q14.8 9.2 22.5 12Q14.8 14.8 12 22.5Q9.2 14.8 1.5 12Q9.2 9.2 12 1.5Z" />
  </svg>;
}
