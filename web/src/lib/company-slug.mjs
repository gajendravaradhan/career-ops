/**
 * Derive the ASCII key used by the existing flat CV/cover filename convention.
 * A name with no usable key must fail closed: an empty search key matches every
 * filename and can attach another application's document (#2352).
 */
export function companySlug(company) {
  const value = String(company ?? "").trim();
  if (!value) return null;
  const slug = (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).join("-");
  return slug ? { slug, first: slug.split("-")[0] } : null;
}
