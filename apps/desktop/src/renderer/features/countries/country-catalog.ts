import countries from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json";

countries.registerLocale(en);

type CountryAlias = {
  name: string;
  iso2Code: string;
  iso3Code: string;
};

const operatorAliases: CountryAlias[] = [
  { name: "England", iso2Code: "GB", iso3Code: "GBR" }
];

export type ResolvedCountry = CountryAlias;

const canonicalNames = Object.values(countries.getNames("en"));

export const countryNames = [...new Set([...canonicalNames, ...operatorAliases.map((country) => country.name)])].sort((left, right) =>
  left.localeCompare(right)
);

export function resolveCountryName(value: string): ResolvedCountry | undefined {
  const name = value.trim();
  if (!name || name.localeCompare("FIFA", undefined, { sensitivity: "accent" }) === 0) {
    return undefined;
  }

  const alias = operatorAliases.find((country) => country.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0);
  if (alias) {
    return alias;
  }

  const iso2Code = countries.getAlpha2Code(name, "en");
  const iso3Code = countries.getAlpha3Code(name, "en");
  if (!iso2Code || !iso3Code || iso2Code === "XX" || iso3Code === "XXX") {
    return undefined;
  }

  return { name, iso2Code, iso3Code };
}
