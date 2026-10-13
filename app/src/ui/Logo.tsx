/** A logo in its light and dark versions; the stylesheet shows the one for the current theme. */
export function Logo({
  name,
  className,
  alt = '',
}: {
  name: 'sparrow-studio-wordmark' | 'sparrow-studio';
  className: string;
  alt?: string;
}) {
  const base = import.meta.env.BASE_URL;
  return (
    <>
      <img className={`${className} logo-light`} src={`${base}${name}.svg`} alt={alt} />
      <img className={`${className} logo-dark`} src={`${base}${name}-dark.svg`} alt={alt} />
    </>
  );
}
