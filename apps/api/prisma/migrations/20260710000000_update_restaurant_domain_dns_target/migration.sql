ALTER TABLE "RestaurantDomain" ALTER COLUMN "dnsTarget" SET DEFAULT 'cname.vercel-dns.com';

UPDATE "RestaurantDomain"
SET "dnsTarget" = 'cname.vercel-dns.com'
WHERE "dnsTarget" = 'sites.loohar.com';
