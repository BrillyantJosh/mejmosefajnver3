import { Card, CardContent } from "@/components/ui/card";
import { ExternalLink } from "lucide-react";

const countries = [
  {
    id: "slovenia",
    name: "Slovenia",
    flag: "\u{1F1F8}\u{1F1EE}",
    url: "https://app.novadrzava.org/",
  },
];

export default function TaxCountries() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">TAX</h1>
        <p className="text-muted-foreground">
          Select your country to access the tax reporting tool for Lana to FIAT exchange
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {countries.map((country) => (
          <a
            key={country.id}
            href={country.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block group"
          >
            <Card className="transition-all duration-200 hover:shadow-lg hover:-translate-y-1 cursor-pointer">
              <CardContent className="flex items-center gap-4 p-6">
                <span className="text-4xl">{country.flag}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-lg">{country.name}</p>
                </div>
                <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
              </CardContent>
            </Card>
          </a>
        ))}
      </div>
    </div>
  );
}
