/** A search of the projects by name. */
export function Search({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="search">
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-4-4" />
      </svg>
      <input
        aria-label="Search projects"
        placeholder="Search projects"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
