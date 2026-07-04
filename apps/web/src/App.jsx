import {
  Activity,
  Bike,
  CheckCircle2,
  ChefHat,
  Clock,
  CreditCard,
  LayoutDashboard,
  LogIn,
  LogOut,
  MapPin,
  Menu as MenuIcon,
  PackageCheck,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Shield,
  Store,
  TicketPercent,
  Trash2,
  Truck,
  UserCog,
  Users
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import DriverPwaApp from "./apps/driver/DriverApp.jsx";
import { api, checkApiHealth } from "./lib/api.js";
import { demoAudit, demoCustomerSummary, demoCustomers, demoDrivers, demoGallery, demoGrowth, demoOrders, demoRestaurant, demoRestaurants, demoSocialLinks, demoWebsiteBundle, demoWebsiteSettings, demoDomain } from "./data/demo.js";

const roleTabs = {
  SUPER_ADMIN: ["admin"],
  RESTAURANT_OWNER: ["restaurant"],
  RESTAURANT_MANAGER: ["restaurant"],
  KITCHEN_STAFF: ["restaurant"],
  DRIVER: ["driver"],
  CUSTOMER: ["customer"]
};

const tabs = [
  { id: "admin", label: "Master Admin", icon: Shield },
  { id: "restaurant", label: "Restaurant", icon: ChefHat },
  { id: "customer", label: "Customer", icon: Store },
  { id: "driver", label: "Driver", icon: Bike }
];

const businessTypes = ["RESTAURANT", "COFFEE_SHOP", "BAKERY", "FOOD_TRUCK", "CONVENIENCE_STORE", "GAS_STATION_FOOD_SHOP", "LIQUOR_STORE", "OTHER_FOOD_RETAIL"];
const businessModules = ["RESTAURANT_ORDERING", "PICKUP", "DELIVERY", "DRIVER_MANAGEMENT", "LOYALTY", "COUPONS", "DELIVERY_ZONES", "FOOD_CATALOG"];
const planCodes = ["STARTER", "PROFESSIONAL", "ENTERPRISE"];

function slugify(value = "") {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function moduleDefaultsFor(businessType = "RESTAURANT") {
  if (["CONVENIENCE_STORE", "GAS_STATION_FOOD_SHOP", "LIQUOR_STORE", "OTHER_FOOD_RETAIL"].includes(businessType)) {
    return ["PICKUP", "DELIVERY", "DRIVER_MANAGEMENT", "COUPONS", "FOOD_CATALOG"];
  }
  return businessModules;
}

function createAdminForm() {
  return {
    name: "",
    businessName: "",
    slug: "",
    businessType: "RESTAURANT",
    enabledModules: moduleDefaultsFor("RESTAURANT"),
    ownerEmail: "",
    ownerPassword: "ChangeMe123!",
    planCode: "STARTER",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    timezone: "America/Denver",
    deliveryEnabled: true,
    pickupEnabled: true,
    websiteEnabled: true,
    cuisineType: "Restaurant"
  };
}

function tenantEditState(restaurant) {
  if (!restaurant) return null;
  return {
    id: restaurant.id,
    name: restaurant.name || "",
    businessName: restaurant.businessName || restaurant.name || "",
    ownerEmail: restaurant.users?.find((user) => user.role === "RESTAURANT_OWNER")?.email || restaurant.users?.[0]?.email || "",
    slug: restaurant.slug || "",
    businessType: restaurant.businessType || "RESTAURANT",
    enabledModules: restaurant.enabledModules || moduleDefaultsFor(restaurant.businessType),
    status: restaurant.status || "ACTIVE",
    email: restaurant.email || "",
    phone: restaurant.phone || "",
    address: restaurant.address || "",
    city: restaurant.city || "",
    state: restaurant.state || "",
    zip: restaurant.zip || "",
    timezone: restaurant.timezone || "America/Denver",
    deliveryEnabled: restaurant.deliveryEnabled !== false,
    pickupEnabled: restaurant.pickupEnabled !== false,
    websiteEnabled: restaurant.websiteSettings?.websiteEnabled !== false,
    cuisineType: restaurant.websiteSettings?.cuisineType || "",
    customDomain: restaurant.domains?.[0]?.customDomain || "",
    domainStatus: restaurant.domains?.[0]?.domainStatus || "PENDING_VERIFICATION",
    planCode: restaurant.subscriptions?.find((subscription) => subscription.active !== false)?.plan?.code || restaurant.subscriptions?.[0]?.plan?.code || "STARTER"
  };
}

function scalarTenantPayload(tenant) {
  return {
    name: tenant.name,
    businessName: tenant.businessName || tenant.name,
    slug: tenant.slug,
    businessType: tenant.businessType,
    enabledModules: tenant.enabledModules,
    status: tenant.status,
    email: tenant.email,
    phone: tenant.phone,
    address: tenant.address,
    city: tenant.city,
    state: tenant.state,
    zip: tenant.zip,
    timezone: tenant.timezone,
    deliveryEnabled: tenant.deliveryEnabled,
    pickupEnabled: tenant.pickupEnabled
  };
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateTenantForm(form) {
  const errors = {};
  const required = [
    ["name", "Business name is required."],
    ["businessName", "Public business name is required."],
    ["slug", "Slug is required."],
    ["businessType", "Business type is required."],
    ["planCode", "Plan is required."],
    ["ownerEmail", "Owner email is required."],
    ["email", "Business email is required."],
    ["phone", "Phone is required."],
    ["address", "Address is required."],
    ["city", "City is required."],
    ["state", "State is required."],
    ["zip", "ZIP is required."]
  ];
  required.forEach(([field, message]) => {
    if (!String(form[field] || "").trim()) errors[field] = message;
  });
  if (form.slug && !/^[a-z0-9-]+$/.test(form.slug)) errors.slug = "Use lowercase letters, numbers, and hyphens only.";
  if (form.ownerEmail && !emailPattern.test(form.ownerEmail)) errors.ownerEmail = "Enter a valid owner email.";
  if (form.email && !emailPattern.test(form.email)) errors.email = "Enter a valid business email.";
  return errors;
}

function tenantCreatePayload(form) {
  return {
    name: form.name,
    businessName: form.name,
    publicBusinessName: form.businessName,
    slug: form.slug,
    businessType: form.businessType,
    plan: form.planCode,
    planCode: form.planCode,
    ownerEmail: form.ownerEmail,
    ownerPassword: form.ownerPassword,
    businessEmail: form.email,
    email: form.email,
    phone: form.phone,
    categoryLabel: form.cuisineType,
    cuisineType: form.cuisineType,
    address: form.address,
    city: form.city,
    state: form.state,
    zip: form.zip,
    timezone: form.timezone,
    websiteEnabled: form.websiteEnabled,
    pickupEnabled: form.pickupEnabled,
    deliveryEnabled: form.deliveryEnabled,
    enabledModules: form.enabledModules
  };
}

function FieldError({ message }) {
  return message ? <p className="field-error">{message}</p> : null;
}

function money(cents = 0) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents || 0) / 100);
}

function roleDefaultTab(role) {
  return roleTabs[role]?.[0] || "customer";
}

function canOpenTab(user, tabId, apiOnline) {
  if (!apiOnline || !user) return true;
  return roleTabs[user.role]?.includes(tabId);
}

function normalizePublicRestaurant(payload) {
  if (!payload) return demoRestaurant;
  return payload.restaurant || payload;
}

function readable(value = "") {
  return value.toLowerCase().replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function isOrderingBusiness(businessType) {
  return ["RESTAURANT", "COFFEE_SHOP", "BAKERY", "FOOD_TRUCK"].includes(businessType || "RESTAURANT");
}

function StatusPill({ children, tone = "neutral" }) {
  const tones = {
    neutral: "bg-slate-100 text-slate-700",
    good: "bg-emerald-100 text-emerald-700",
    warn: "bg-amber-100 text-amber-800",
    bad: "bg-rose-100 text-rose-700"
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

function Stat({ icon: Icon, label, value, detail }) {
  return (
    <div className="panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-bold text-ink">{value}</p>
          {detail ? <p className="mt-1 text-sm text-slate-500">{detail}</p> : null}
        </div>
        <div className="grid h-11 w-11 place-items-center rounded-md bg-mint/10 text-mint">
          <Icon size={22} />
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ eyebrow, title, action, icon: Icon = LayoutDashboard }) {
  return (
    <div className="mb-5 flex flex-col justify-between gap-3 md:flex-row md:items-end">
      <div>
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-mint"><Icon size={15} />{eyebrow}</p>
        <h2 className="mt-1 text-2xl font-bold text-ink">{title}</h2>
      </div>
      {action}
    </div>
  );
}

function EmptyState({ title, detail }) {
  return (
    <div className="empty-state">
      <p className="font-bold text-ink">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{detail}</p>
    </div>
  );
}

function InlineError({ message }) {
  return message ? <div className="error-box">{message}</div> : null;
}

function dietaryBadges(item = {}) {
  return [
    item.isGlutenFree ? "Gluten Free" : null,
    item.isVegetarian ? "Vegetarian" : null,
    item.isVegan ? "Vegan" : null,
    item.isSpicy ? "Spicy" : null,
    item.isDairyFree ? "Dairy Free" : null,
    item.isNutFree ? "Nut Free" : null
  ].filter(Boolean);
}

function websitePathParts() {
  const [, root, slug, page = "home"] = window.location.pathname.split("/");
  if (root !== "sites") return null;
  return { slug: slug || "demo-bistro", page };
}

function PublicRestaurantSite({ apiOnline }) {
  const route = websitePathParts();
  const slug = route?.slug || "demo-bistro";
  const page = route?.page || "home";
  const [bundle, setBundle] = useState(() => demoWebsiteBundle(slug));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!apiOnline) {
      setBundle(demoWebsiteBundle(slug));
      return;
    }
    api(`/api/public/restaurants/${slug}/website`)
      .then(setBundle)
      .catch((loadError) => setError(loadError.message));
  }, [apiOnline, slug]);

  useEffect(() => {
    document.title = bundle.seo?.title || bundle.website?.seoTitle || bundle.restaurant?.name || "Restaurant Website";
    const description = document.querySelector("meta[name='description']");
    if (description) description.setAttribute("content", bundle.seo?.description || bundle.website?.seoDescription || "");
  }, [bundle]);

  const restaurant = bundle.restaurant || demoRestaurant;
  const website = bundle.website || demoWebsiteSettings;
  const gallery = bundle.gallery || demoGallery;
  const socialLinks = bundle.socialLinks || demoSocialLinks;
  const categories = restaurant.categories || [];
  const featuredItems = categories.flatMap((category) => category.items || []).filter((item) => item.featured || item.recommended).slice(0, 4);
  const routeBase = `/sites/${restaurant.slug}`;

  if (page === "order") return <div className="site-shell"><CustomerApp apiOnline={apiOnline} initialSlug={slug} embedded /></div>;

  function navLink(target, label) {
    return <a className={page === target ? "site-nav active" : "site-nav"} href={target === "home" ? routeBase : `${routeBase}/${target}`}>{label}</a>;
  }

  return (
    <div className="site-shell" style={{ "--brand": website.brandColor, "--accent": website.accentColor }}>
      <InlineError message={error} />
      <header className="site-header">
        <div>
          <p className="site-logo">{website.logoUrl ? "Logo" : restaurant.businessName || restaurant.name}</p>
          <h1>{restaurant.businessName || restaurant.name}</h1>
          <p>{website.heroSubtitle || restaurant.description}</p>
        </div>
        <nav className="site-navs">
          {navLink("home", "Home")}
          {navLink("menu", "Menu")}
          {navLink("about", "About")}
          {navLink("contact", "Contact")}
          {navLink("gallery", "Gallery")}
          {navLink("loyalty", "Loyalty")}
          {navLink("catering", "Catering")}
          {navLink("careers", "Careers")}
        </nav>
      </header>

      {page === "home" ? (
        <>
          <section className="site-hero">
            <div>
              <StatusPill tone="good">{restaurant.pickupEnabled ? "Pickup" : "Pickup off"}</StatusPill>
              <StatusPill tone={restaurant.deliveryEnabled ? "good" : "neutral"}>{restaurant.deliveryEnabled ? "Delivery" : "Delivery off"}</StatusPill>
              <h2>{website.heroTitle || restaurant.name}</h2>
              <p>{website.heroSubtitle || restaurant.description}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <a className="button-primary" href={`${routeBase}/order`}><CreditCard size={18} />Order Online</a>
                <a className="button-muted" href={`tel:${restaurant.phone || ""}`}>Call {restaurant.phone || "Restaurant"}</a>
              </div>
            </div>
            <div className="site-image">{website.heroImageUrl ? "Hero image placeholder" : "Fresh food"}</div>
          </section>
          <section className="site-grid">
            <div className="site-card"><h3>Featured menu</h3>{featuredItems.length === 0 ? <p>No featured items yet.</p> : featuredItems.map((item) => <div className="summary-line" key={item.id}><span>{item.name}</span><strong>{money(item.priceCents)}</strong></div>)}</div>
            <div className="site-card"><h3>Special offer</h3><p>{website.specialOfferText || "Order direct for loyalty rewards."}</p></div>
            <div className="site-card"><h3>Visit us</h3><p>{restaurant.address}</p><p>{restaurant.phone}</p><p>{Object.entries(restaurant.storeHoursJson || {}).slice(0, 3).map(([day, hours]) => `${readable(day)} ${hours}`).join(" / ") || "Store hours placeholder"}</p></div>
          </section>
        </>
      ) : null}

      {page === "menu" ? (
        <section className="site-card">
          <h2>Menu</h2>
          {categories.map((category) => (
            <div className="mt-5" key={category.id}>
              <h3>{category.name}</h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {(category.items || []).map((item) => <div className="food-card" key={item.id}><div><p className="font-bold text-ink">{item.name}</p><p className="text-sm text-slate-500">{item.description}</p><p className="mt-2 text-sm">{item.available === false ? "Unavailable" : "Available"} {item.featured ? "- Featured" : ""} {item.recommended ? "- Recommended" : ""}</p></div><a className="button-primary h-fit" href={`${routeBase}/order`}>{money(item.priceCents)}</a></div>)}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {page === "about" ? <section className="site-card"><h2>{website.aboutTitle}</h2><p>{website.aboutStory}</p><h3>Mission</h3><p>{website.missionStatement}</p><h3>Owner / chef story</h3><p>{website.ownerStory}</p><div className="site-image mt-4">About image placeholder</div></section> : null}
      {page === "contact" ? <section className="site-grid"><div className="site-card"><h2>Contact</h2><p>{restaurant.address}</p><p>{restaurant.phone}</p><p>{restaurant.email}</p><p>{Object.entries(restaurant.storeHoursJson || {}).map(([day, hours]) => `${readable(day)}: ${hours}`).join(" / ") || "Store hours placeholder"}</p>{socialLinks.map((link) => <a className="site-nav mr-2" href={link.url} key={link.id}>{link.platform}</a>)}</div><div className="site-card"><h3>Map</h3><div className="site-image">Map placeholder</div><h3 className="mt-4">Contact form</h3><p>Contact form placeholder.</p></div></section> : null}
      {page === "gallery" ? <section className="site-card"><h2>Gallery</h2><div className="mt-4 grid gap-3 md:grid-cols-3">{gallery.map((image) => <div className="site-image" key={image.id}>{image.altText || "Restaurant photo"}</div>)}</div><p className="mt-4 text-sm text-slate-500">Image upload placeholder for restaurant, food, and interior photos.</p></section> : null}
      {page === "loyalty" ? <section className="site-card"><h2>Loyalty</h2><p>Earn {restaurant.loyaltySettingsJson?.pointsPerDollar || 1} point per dollar when ordering direct.</p><div className="mt-4 grid gap-3 md:grid-cols-2">{(restaurant.loyaltyRewards || bundle.restaurant?.loyaltyRewards || []).map((reward) => <div className="summary-line rounded-md bg-slate-50 px-3" key={reward.id}><span>{reward.name}</span><strong>{reward.pointsRequired} pts</strong></div>)}</div><button className="button-primary mt-4">Sign in / join placeholder</button></section> : null}
      {page === "catering" ? <section className="site-card"><h2>Catering</h2><p>Bring restaurant favorites to your next event. Full catering workflow is planned for a later phase.</p><button className="button-primary mt-4">Request catering</button><p className="mt-3 text-sm text-slate-500">Contact form placeholder.</p></section> : null}
      {page === "careers" ? <section className="site-card"><h2>Careers</h2><p>We are always interested in great restaurant people. Open roles placeholder.</p><button className="button-primary mt-4">Apply placeholder</button></section> : null}

      <footer className="site-footer">
        <span>{restaurant.businessName || restaurant.name}</span>
        <span>{restaurant.address}</span>
        <span>Direct ordering powered by your platform</span>
      </footer>
    </div>
  );
}

function PremiumRestaurantSite({ apiOnline }) {
  const route = websitePathParts();
  const slug = route?.slug || "demo-bistro";
  const page = route?.page || "home";
  const [bundle, setBundle] = useState(() => demoWebsiteBundle(slug));
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!apiOnline) {
      setBundle(demoWebsiteBundle(slug));
      return;
    }
    api(`/api/public/restaurants/${slug}/website`)
      .then(setBundle)
      .catch((loadError) => setError(loadError.message));
  }, [apiOnline, slug]);

  useEffect(() => {
    document.title = bundle.seo?.title || bundle.website?.seoTitle || bundle.restaurant?.name || "Restaurant Website";
    const description = document.querySelector("meta[name='description']");
    if (description) description.setAttribute("content", bundle.seo?.description || bundle.website?.seoDescription || "");
  }, [bundle]);

  const restaurant = bundle.restaurant || demoRestaurant;
  const website = bundle.website || demoWebsiteSettings;
  const gallery = bundle.gallery || demoGallery;
  const socialLinks = bundle.socialLinks || demoSocialLinks;
  const categories = restaurant.categories || [];
  const allItems = categories.flatMap((category) => category.items || []);
  const featuredItems = allItems.filter((itemRow) => itemRow.featured || itemRow.recommended).slice(0, 4);
  const rewards = restaurant.loyaltyRewards || bundle.restaurant?.loyaltyRewards || demoGrowth.loyalty.rewards;
  const routeBase = `/sites/${restaurant.slug}`;
  const hours = Object.entries(restaurant.storeHoursJson || {});
  const hoursPreview = hours.slice(0, 3).map(([day, value]) => `${readable(day)} ${value}`).join(" / ");
  const isLiquor = restaurant.businessType === "LIQUOR_STORE";

  if (page === "order") return <div className="site-shell premium"><CustomerApp apiOnline={apiOnline} initialSlug={slug} embedded /></div>;

  function navLink(target, label) {
    return <a className={page === target ? "site-nav active" : "site-nav"} href={target === "home" ? routeBase : `${routeBase}/${target}`}>{label}</a>;
  }

  function MenuCard({ item: menuItem }) {
    return (
      <article className="lux-menu-card">
        <img src={menuItem.imageUrl || website.heroImageUrl} alt={menuItem.name} />
        <div>
          <div className="flex flex-wrap gap-2">
            {menuItem.featured ? <span className="lux-badge">Featured</span> : null}
            {menuItem.recommended ? <span className="lux-badge muted">Recommended</span> : null}
          </div>
          <h3>{menuItem.name}</h3>
          <p>{menuItem.description}</p>
          <div className="mt-3 flex flex-wrap gap-2">{dietaryBadges(menuItem).map((badge) => <span className="diet-badge" key={badge}>{badge}</span>)}</div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="font-black text-ink">{money(menuItem.priceCents)}</span>
            <span className="text-xs font-bold uppercase text-slate-400">{menuItem.preparationTimeMins} min</span>
            <a className="button-primary" href={`${routeBase}/order`}>Add to order</a>
          </div>
        </div>
      </article>
    );
  }

  return (
    <div className="site-shell premium" style={{ "--brand": website.brandColor, "--accent": website.accentColor }}>
      <InlineError message={error} />
      <header className="site-header premium">
        <a className="site-brand" href={routeBase}>
          <img src={website.logoUrl || website.heroImageUrl} alt={`${restaurant.name} logo`} />
          <div>
            <strong>{restaurant.businessName || restaurant.name}</strong>
            <span>{website.tagline || website.cuisineType || "Restaurant-owned ordering"}</span>
          </div>
        </a>
        <button className="site-menu-toggle" onClick={() => setMenuOpen((open) => !open)}>Menu</button>
        <nav className={`site-navs ${menuOpen ? "open" : ""}`}>
          {navLink("home", "Home")}
          {navLink("menu", "Menu")}
          {navLink("order", "Order Online")}
          {navLink("about", "About")}
          {navLink("gallery", "Gallery")}
          {navLink("loyalty", "Loyalty")}
          {navLink("catering", "Catering")}
          {navLink("contact", "Contact")}
        </nav>
      </header>

      {page === "home" ? (
        <>
          <section className="lux-hero" style={{ backgroundImage: `linear-gradient(90deg, rgba(8,18,16,.9), rgba(8,18,16,.48)), url(${website.heroImageUrl})` }}>
            <div className="lux-hero-content">
              <p className="lux-kicker">{website.cuisineType || "Modern American"} / {website.tagline || "Seasonal Bistro"}</p>
              <h2>{website.heroTitle || restaurant.name}</h2>
              <p>{website.heroSubtitle || restaurant.description}</p>
              <div className="mt-6 flex flex-wrap gap-2">
                <a className="button-primary" href={`${routeBase}/order`}><CreditCard size={18} />Order Online</a>
                <a className="button-muted" href={`${routeBase}/menu`}>View Menu</a>
                <a className="button-muted" href={`tel:${restaurant.phone || ""}`}>Call {restaurant.phone || "Restaurant"}</a>
              </div>
              <div className="lux-hero-meta">
                <span>{restaurant.deliveryEnabled ? "Delivery available" : "Pickup focused"}</span>
                <span>{restaurant.pickupEnabled ? "Pickup ready" : "Pickup unavailable"}</span>
                <span>{hoursPreview || "Open daily"}</span>
                {isLiquor ? <span>Age verification required</span> : null}
              </div>
            </div>
          </section>
          <section className="lux-section">
            <div className="lux-section-head"><p>Featured dishes</p><h2>Kitchen favorites</h2><a href={`${routeBase}/menu`}>Explore full menu</a></div>
            <div className="lux-card-grid">{featuredItems.map((menuItem) => <MenuCard item={menuItem} key={menuItem.id} />)}</div>
          </section>
          <section className="lux-split">
            <img src={gallery[0]?.imageUrl || website.heroImageUrl} alt={gallery[0]?.altText || restaurant.name} />
            <div>
              <p className="lux-kicker">About the restaurant</p>
              <h2>{website.aboutTitle}</h2>
              <p>{website.aboutStory}</p>
              <a className="button-primary mt-5" href={`${routeBase}/about`}>Read our story</a>
            </div>
          </section>
          <section className="site-grid">
            <div className="site-card"><h3>Special offer</h3><p>{website.specialOfferText}</p><a className="button-primary mt-4" href={`${routeBase}/order`}>Redeem online</a></div>
            <div className="site-card"><h3>Guest notes</h3><p>"Beautiful dinner, easy direct ordering, and the delivery arrived hot."</p><p>"The salmon and short rib are repeat-order favorites."</p></div>
            <div className="site-card"><h3>Location & hours</h3><p>{restaurant.address}</p><p>{restaurant.phone}</p><p>{hoursPreview || "Hours available soon"}</p></div>
          </section>
          {isLiquor ? <section className="site-card"><h3>Age verification and compliance</h3><p>{bundle.complianceNote || "Age verification and local delivery compliance are required for regulated items."}</p></section> : null}
          <section className="lux-gallery-strip">{gallery.slice(0, 4).map((image) => <img src={image.imageUrl} alt={image.altText} key={image.id} />)}</section>
          <section className="lux-cta"><h2>Order direct from {restaurant.businessName || restaurant.name}</h2><p>Keep more value with the restaurant while earning loyalty rewards.</p><a className="button-primary" href={`${routeBase}/order`}>Start an order</a></section>
        </>
      ) : null}

      {page === "menu" ? <section className="lux-section"><div className="lux-section-head"><p>Full menu</p><h2>{isLiquor ? "Bottle shop catalog" : "Prepared for pickup and delivery"}</h2><a href={`${routeBase}/order`}>Order now</a></div>{isLiquor ? <div className="site-card mb-4"><h3>Regulated items</h3><p>{bundle.complianceNote || "Age verification and local delivery compliance placeholders apply."}</p></div> : null}{categories.map((category) => <div className="lux-category" key={category.id}><h3>{category.name}</h3><div className="lux-card-grid">{(category.items || []).map((menuItem) => <MenuCard item={menuItem} key={menuItem.id} />)}</div></div>)}</section> : null}
      {page === "about" ? <section className="lux-split page"><img src={gallery[1]?.imageUrl || website.heroImageUrl} alt="Chef and restaurant team" /><div><p className="lux-kicker">Our story</p><h2>{website.aboutTitle}</h2><p>{website.aboutStory}</p><h3>Mission</h3><p>{website.missionStatement}</p><h3>Fresh ingredients</h3><p>Seasonal produce, thoughtful sourcing, and a menu designed for dining room quality at home.</p><h3>Community</h3><p>Ordering direct helps keep customer relationships and revenue with the local restaurant team.</p></div></section> : null}
      {page === "contact" ? <section className="site-grid contact"><div className="site-card"><h2>Contact</h2><p>{restaurant.address}</p><p>{restaurant.phone}</p><p>{restaurant.email}</p><p>Delivery zone note: direct delivery availability depends on restaurant settings.</p><p>Parking note: street and nearby garage parking placeholder.</p>{socialLinks.map((link) => <a className="site-nav mr-2" href={link.url} key={link.id}>{link.platform}</a>)}</div><div className="site-card"><h3>Opening hours</h3>{hours.map(([day, value]) => <div className="summary-line" key={day}><span>{readable(day)}</span><strong>{value}</strong></div>)}</div><div className="site-card"><h3>Map & message</h3><div className="map-card">Map placeholder for {restaurant.address}</div><p className="mt-4">Contact form placeholder for private events, questions, and order help.</p></div></section> : null}
      {page === "gallery" ? <section className="lux-section"><div className="lux-section-head"><p>Gallery</p><h2>Food, room, team, and events</h2><a href={`${routeBase}/order`}>Order from the menu</a></div><div className="lux-gallery-grid">{gallery.map((image) => <figure key={image.id}><img src={image.imageUrl} alt={image.altText} /><figcaption>{image.altText} / {image.category || "food"}</figcaption></figure>)}</div></section> : null}
      {page === "loyalty" ? <section className="lux-section"><div className="lux-section-head"><p>Loyalty</p><h2>Rewards for ordering direct</h2><a href={`${routeBase}/order`}>Join at checkout</a></div><div className="site-grid"><div className="site-card"><h3>How it works</h3><p>Earn {restaurant.loyaltySettingsJson?.pointsPerDollar || 1} point per dollar on eligible direct orders. Redeem points for restaurant-owned rewards.</p><button className="button-primary mt-4">Sign in / join placeholder</button></div>{rewards.map((reward) => <div className="site-card" key={reward.id}><h3>{reward.name}</h3><p>{reward.pointsRequired} points required.</p></div>)}</div></section> : null}
      {page === "catering" ? <section className="lux-section"><div className="lux-section-head"><p>Catering</p><h2>Events, party trays, and corporate lunches</h2><a href={`tel:${restaurant.phone || ""}`}>Call restaurant</a></div><div className="site-grid"><div className="site-card"><h3>Party trays</h3><p>Shareable appetizers, salads, and entrees sized for groups.</p></div><div className="site-card"><h3>Corporate lunch</h3><p>Pickup and delivery-friendly lunch packages for teams.</p></div><div className="site-card"><h3>Family meals</h3><p>Comfortable dinner packages built around restaurant favorites.</p></div></div><div className="site-card"><h3>Request quote</h3><p>Quote form placeholder for event date, guest count, and menu preferences.</p><button className="button-primary mt-4">Request quote</button></div></section> : null}
      {page === "careers" ? <section className="lux-section"><div className="lux-section-head"><p>Careers</p><h2>Join the restaurant team</h2><a href={`mailto:${restaurant.email || ""}`}>Contact hiring manager</a></div><div className="site-grid"><div className="site-card"><h3>Why work here</h3><p>Focused service, direct customer relationships, and a team built around hospitality.</p></div><div className="site-card"><h3>Open roles</h3><p>Line cook, server, bartender, host, and driver placeholders.</p></div><div className="site-card"><h3>Apply</h3><p>Application form placeholder.</p><button className="button-primary mt-4">Apply placeholder</button></div></div></section> : null}

      <footer className="site-footer premium">
        <span>{restaurant.businessName || restaurant.name}</span>
        <span>{restaurant.address}</span>
        <span>Direct ordering powered by your platform</span>
      </footer>
    </div>
  );
}

function LoginStrip({ apiOnline, token, user, onLogin, onLogout, setActive }) {
  const [email, setEmail] = useState("admin@platform.local");
  const [password, setPassword] = useState("Admin123!");
  const [message, setMessage] = useState(apiOnline ? "Sign in with a seeded account." : "Demo fallback is active because the API is offline.");
  const [loading, setLoading] = useState(false);

  async function login(event) {
    event.preventDefault();
    setLoading(true);
    try {
      const payload = await api("/api/auth/login", { method: "POST", body: { email, password } });
      onLogin(payload);
      setActive(roleDefaultTab(payload.user.role));
      setMessage(`Signed in as ${payload.user.role}`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={login} className="panel flex flex-col gap-3 md:flex-row md:items-end">
      <label className="flex-1 text-sm font-semibold text-slate-600">
        Email
        <input className="input mt-1" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label className="flex-1 text-sm font-semibold text-slate-600">
        Password
        <input className="input mt-1" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      {token ? (
        <button className="button-muted" type="button" onClick={onLogout}><LogOut size={18} />Logout</button>
      ) : (
        <button className="button-primary" type="submit" disabled={loading || !apiOnline}><LogIn size={18} />{loading ? "Signing in" : "Login"}</button>
      )}
      <p className="text-sm text-slate-500 md:max-w-xs">{user ? `${user.name} - ${user.role}` : message}</p>
    </form>
  );
}

function AdminApp({ apiOnline, token, onImpersonate }) {
  const [restaurants, setRestaurants] = useState(demoRestaurants);
  const [auditLogs, setAuditLogs] = useState(demoAudit);
  const [analytics, setAnalytics] = useState({ restaurants: demoRestaurants.length, activeDrivers: 9, activeCustomers: 1348, revenue: { amountCents: 1840000, technologyFeeCents: 81200, driverTipCents: 42000 } });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [formErrors, setFormErrors] = useState({});
  const [creatingTenant, setCreatingTenant] = useState(false);
  const [savingTenant, setSavingTenant] = useState(false);
  const [businessTypeFilter, setBusinessTypeFilter] = useState("");
  const [form, setForm] = useState(createAdminForm);
  const [selectedTenant, setSelectedTenant] = useState(null);
  const liveFormErrors = validateTenantForm(form);
  const canCreateTenant = apiOnline && token && Object.keys(liveFormErrors).length === 0 && !creatingTenant;
  const filteredRestaurants = businessTypeFilter ? restaurants.filter((restaurant) => restaurant.businessType === businessTypeFilter) : restaurants;
  const activeCount = restaurants.filter((restaurant) => restaurant.status === "ACTIVE").length;
  const suspendedCount = restaurants.filter((restaurant) => restaurant.status === "SUSPENDED").length;
  const customerCount = restaurants.reduce((sum, restaurant) => sum + (restaurant._count?.customers || 0), 0);
  const orderCount = restaurants.reduce((sum, restaurant) => sum + (restaurant._count?.orders || 0), 0);
  const currentPlanCounts = planCodes.reduce((counts, plan) => {
    counts[plan] = restaurants.filter((restaurant) => (restaurant.subscriptions?.find((subscription) => subscription.active !== false)?.plan?.code || restaurant.subscriptions?.[0]?.plan?.code) === plan).length;
    return counts;
  }, {});

  async function loadAdmin() {
    if (!apiOnline || !token) return;
    setLoading(true);
    setError("");
    try {
      const [restaurantPayload, analyticsPayload, auditPayload] = await Promise.all([
        api(businessTypeFilter ? `/api/admin/businesses?businessType=${businessTypeFilter}` : "/api/admin/businesses", { token }),
        api("/api/admin/analytics", { token }),
        api("/api/admin/audit-logs", { token })
      ]);
      setRestaurants(restaurantPayload.businesses || restaurantPayload.restaurants || []);
      setAnalytics(analyticsPayload);
      setAuditLogs(auditPayload.auditLogs || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAdmin();
  }, [apiOnline, token, businessTypeFilter]);

  async function createRestaurant(event) {
    event.preventDefault();
    if (!apiOnline) return setError("Start the API to create restaurants.");
    const nextErrors = validateTenantForm(form);
    setFormErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return setError("Fix the highlighted fields before creating this tenant.");
    setError("");
    setSuccess("");
    setCreatingTenant(true);
    try {
      await api("/api/admin/tenants", { method: "POST", token, body: tenantCreatePayload(form) });
      setForm(createAdminForm());
      setFormErrors({});
      setSuccess("Tenant created with owner account, website settings, domain foundation, and starter menu categories.");
      await loadAdmin();
    } catch (createError) {
      setError(createError.message);
    } finally {
      setCreatingTenant(false);
    }
  }

  async function suspendRestaurant(restaurant) {
    if (!apiOnline) return;
    setError("");
    setSuccess("");
    try {
      await api(`/api/admin/businesses/${restaurant.id}/suspend`, { method: "POST", token });
      setSuccess(`${restaurant.businessName || restaurant.name} suspended.`);
      await loadAdmin();
    } catch (suspendError) {
      setError(suspendError.message);
    }
  }

  async function activateRestaurant(restaurant) {
    if (!apiOnline) return;
    setError("");
    setSuccess("");
    try {
      await api(`/api/admin/businesses/${restaurant.id}/activate`, { method: "POST", token });
      setSuccess(`${restaurant.businessName || restaurant.name} activated.`);
      await loadAdmin();
    } catch (activateError) {
      setError(activateError.message);
    }
  }

  async function impersonate(restaurant) {
    if (!apiOnline) return;
    try {
      const payload = await api(`/api/admin/restaurants/${restaurant.id}/impersonate`, { method: "POST", token });
      onImpersonate({ accessToken: payload.accessToken, user: payload.impersonatedUser });
    } catch (impersonateError) {
      setError(impersonateError.message);
    }
  }

  async function assignPlan(restaurant, planCode) {
    if (!apiOnline) return;
    setError("");
    setSuccess("");
    try {
      await api(`/api/admin/tenants/${restaurant.id}/plan`, { method: "PATCH", token, body: { planCode } });
      setSuccess(`${restaurant.businessName || restaurant.name} moved to ${planCode}.`);
      await loadAdmin();
    } catch (planError) {
      setError(planError.message);
    }
  }

  async function toggleWebsite(restaurant) {
    const currentEnabled = restaurant.websiteSettings?.websiteEnabled !== false;
    if (!apiOnline) return;
    setError("");
    setSuccess("");
    try {
      await api(`/api/admin/businesses/${restaurant.id}/website`, { method: "PATCH", token, body: { websiteEnabled: !currentEnabled } });
      setSuccess(`Website ${currentEnabled ? "disabled" : "enabled"} for ${restaurant.businessName || restaurant.name}.`);
      await loadAdmin();
    } catch (websiteError) {
      setError(websiteError.message);
    }
  }

  async function manageDomain(restaurant) {
    if (!apiOnline) return;
    setError("");
    setSuccess("");
    try {
      await api(`/api/admin/businesses/${restaurant.id}/domain`, { method: "PATCH", token, body: { domainStatus: "PENDING_VERIFICATION", sslStatus: "PENDING" } });
      setSuccess(`Domain verification reset. Create a CNAME record pointing to sites.loohar.com.`);
      await loadAdmin();
    } catch (domainError) {
      setError(domainError.message);
    }
  }

  async function saveSelectedTenant(event) {
    event.preventDefault();
    if (!selectedTenant) return;
    if (!apiOnline) return setError("API is offline. Demo tenants can be reviewed, but changes are not saved.");
    setError("");
    setSuccess("");
    setSavingTenant(true);
    try {
      await api(`/api/admin/tenants/${selectedTenant.id}`, { method: "PATCH", token, body: scalarTenantPayload(selectedTenant) });
      await api(`/api/admin/tenants/${selectedTenant.id}/website`, { method: "PATCH", token, body: { websiteEnabled: selectedTenant.websiteEnabled, cuisineType: selectedTenant.cuisineType } });
      if (selectedTenant.customDomain) {
        await api(`/api/admin/tenants/${selectedTenant.id}/domain`, { method: "PATCH", token, body: { customDomain: selectedTenant.customDomain, domainStatus: selectedTenant.domainStatus } });
      }
      await assignPlan(selectedTenant, selectedTenant.planCode);
      setSelectedTenant(null);
      setSuccess("Tenant settings saved.");
      await loadAdmin();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingTenant(false);
    }
  }

  function updateCreateBusinessName(name) {
    setForm((current) => ({
      ...current,
      name,
      businessName: current.businessName && current.businessName !== current.name ? current.businessName : name,
      slug: current.slug && current.slug !== slugify(current.name) ? current.slug : slugify(name)
    }));
  }

  function updateCreateBusinessType(businessType) {
    setForm((current) => ({ ...current, businessType, enabledModules: moduleDefaultsFor(businessType), cuisineType: current.cuisineType || readable(businessType) }));
  }

  function ownerFor(restaurant) {
    return restaurant.users?.find((user) => user.role === "RESTAURANT_OWNER") || restaurant.users?.[0];
  }

  function domainFor(restaurant) {
    return restaurant.domains?.[0];
  }

  return (
    <div className="space-y-6">
      <SectionHeader eyebrow="Platform owner" title="Food business admin center" icon={Shield} action={<button className="button-muted" onClick={loadAdmin}><RefreshCw size={18} />Refresh</button>} />
      <InlineError message={error} />
      {success ? <div className="success-box">{success}</div> : null}
      {!apiOnline ? <div className="error-box">API offline. Master Admin is showing demo data only; create, edit, domain, impersonation, and plan changes need the live API.</div> : null}
      <div className="grid gap-4 md:grid-cols-4">
        <Stat icon={Store} label="Food businesses" value={analytics.businesses ?? analytics.restaurants ?? restaurants.length} detail={`${activeCount} active / ${suspendedCount} suspended`} />
        <Stat icon={ReceiptText} label="Gross order volume" value={money(analytics.revenue?.amountCents)} detail="Across all tenants" />
        <Stat icon={Truck} label="Active drivers" value={analytics.activeDrivers ?? 0} detail="Owned restaurant fleets" />
        <Stat icon={CreditCard} label="Tech fees" value={money(analytics.revenue?.technologyFeeCents)} detail="Subscription plus usage" />
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Stat icon={Users} label="Customers" value={analytics.activeCustomers ?? customerCount} detail="Direct restaurant customers" />
        <Stat icon={PackageCheck} label="Orders" value={orderCount || "Demo"} detail="Tenant-owned order records" />
        <Stat icon={TicketPercent} label="Professional plans" value={currentPlanCounts.PROFESSIONAL || 0} detail="Delivery, loyalty, coupons" />
        <Stat icon={Shield} label="Enterprise plans" value={currentPlanCounts.ENTERPRISE || 0} detail="Analytics and multi-location ready" />
      </div>
      <form className="panel form-grid" onSubmit={createRestaurant}>
        <h3 className="panel-title md:col-span-3">Create food business</h3>
        <div><input className="input" placeholder="Restaurant or food business name" value={form.name} onChange={(event) => updateCreateBusinessName(event.target.value)} /><FieldError message={formErrors.name} /></div>
        <div><input className="input" placeholder="Public business name" value={form.businessName} onChange={(event) => setForm({ ...form, businessName: event.target.value })} /><FieldError message={formErrors.businessName} /></div>
        <div><input className="input" placeholder="slug" value={form.slug} onChange={(event) => setForm({ ...form, slug: slugify(event.target.value) })} /><FieldError message={formErrors.slug} /></div>
        <div>
          <select className="select" value={form.businessType} onChange={(event) => updateCreateBusinessType(event.target.value)}>
            {businessTypes.map((type) => <option value={type} key={type}>{readable(type)}</option>)}
          </select>
          <FieldError message={formErrors.businessType} />
        </div>
        <div>
          <select className="select" value={form.planCode} onChange={(event) => setForm({ ...form, planCode: event.target.value })}>
            {planCodes.map((plan) => <option key={plan}>{plan}</option>)}
          </select>
          <FieldError message={formErrors.planCode} />
        </div>
        <div><input className="input" placeholder="Owner email" value={form.ownerEmail} onChange={(event) => setForm({ ...form, ownerEmail: event.target.value })} /><FieldError message={formErrors.ownerEmail} /></div>
        <div><input className="input" placeholder="Business email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /><FieldError message={formErrors.email} /></div>
        <div><input className="input" placeholder="Phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /><FieldError message={formErrors.phone} /></div>
        <div><input className="input" placeholder="Cuisine or shop type" value={form.cuisineType} onChange={(event) => setForm({ ...form, cuisineType: event.target.value })} /></div>
        <div><input className="input" placeholder="Address" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /><FieldError message={formErrors.address} /></div>
        <div><input className="input" placeholder="City" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /><FieldError message={formErrors.city} /></div>
        <div><input className="input" placeholder="State" value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} /><FieldError message={formErrors.state} /></div>
        <div><input className="input" placeholder="ZIP" value={form.zip} onChange={(event) => setForm({ ...form, zip: event.target.value })} /><FieldError message={formErrors.zip} /></div>
        <label className="seg"><input type="checkbox" checked={form.websiteEnabled} onChange={(event) => setForm({ ...form, websiteEnabled: event.target.checked })} />Website</label>
        <label className="seg"><input type="checkbox" checked={form.pickupEnabled} onChange={(event) => setForm({ ...form, pickupEnabled: event.target.checked })} />Pickup</label>
        <label className="seg"><input type="checkbox" checked={form.deliveryEnabled} onChange={(event) => setForm({ ...form, deliveryEnabled: event.target.checked })} />Delivery</label>
        <div className="md:col-span-3 flex flex-wrap gap-2">
          {businessModules.map((module) => (
            <button className={`seg ${form.enabledModules.includes(module) ? "active" : ""}`} key={module} type="button" onClick={() => setForm((current) => ({ ...current, enabledModules: current.enabledModules.includes(module) ? current.enabledModules.filter((item) => item !== module) : [...current.enabledModules, module] }))}>
              {readable(module)}
            </button>
          ))}
        </div>
        <button className="button-primary md:col-span-3" type="submit" disabled={!canCreateTenant}><Plus size={18} />{creatingTenant ? "Creating tenant" : "Create food business"}</button>
        {!apiOnline ? <p className="text-sm font-semibold text-rose-600 md:col-span-3">Start the API to create real tenants.</p> : Object.keys(liveFormErrors).length > 0 ? <p className="text-sm font-semibold text-slate-500 md:col-span-3">Fill all required fields to enable tenant creation.</p> : null}
      </form>
      <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="panel">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="panel-title">Food businesses</h3>
            <div className="flex flex-wrap gap-2">
              <select className="select max-w-56" value={businessTypeFilter} onChange={(event) => setBusinessTypeFilter(event.target.value)}>
                <option value="">All food business types</option>
                {businessTypes.map((type) => <option value={type} key={type}>{readable(type)}</option>)}
              </select>
              <div className="search"><Search size={16} /><span>{loading ? "Loading" : "Live business list"}</span></div>
            </div>
          </div>
          {filteredRestaurants.length === 0 ? <EmptyState title="No food businesses yet" detail="Create the first restaurant or food-commerce tenant to begin onboarding." /> : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Food business</th><th>Type</th><th>Owner</th><th>Website</th><th>Domain</th><th>Orders</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {filteredRestaurants.map((restaurant) => (
                    <tr key={restaurant.id}>
                      <td><strong>{restaurant.businessName || restaurant.name}</strong><span>{restaurant.slug} - {restaurant.email || "No business email"}</span><span>{[restaurant.address, restaurant.city, restaurant.state, restaurant.zip].filter(Boolean).join(", ") || "Address not set"}</span></td>
                      <td>{readable(restaurant.businessType || "RESTAURANT")}</td>
                      <td>{ownerFor(restaurant)?.email || "Owner not loaded"}</td>
                      <td><StatusPill tone={restaurant.websiteSettings?.websiteEnabled === false ? "warn" : "good"}>{restaurant.websiteSettings?.websiteEnabled === false ? "Disabled" : "Enabled"}</StatusPill><span>{restaurant.websiteSettings?.cuisineType || "Food ordering"}</span></td>
                      <td>{domainFor(restaurant)?.customDomain || `sites.loohar.com/${restaurant.slug}`}<span>{domainFor(restaurant)?.domainStatus || "Default URL"}</span></td>
                      <td>{restaurant._count?.orders || 0}<span>{restaurant._count?.customers || 0} customers</span></td>
                      <td><StatusPill tone={restaurant.status === "ACTIVE" ? "good" : "bad"}>{restaurant.status}</StatusPill></td>
                      <td>
                        <details className="action-menu">
                          <summary><MenuIcon size={16} />Actions</summary>
                          <div>
                            <button onClick={() => setSelectedTenant(tenantEditState(restaurant))}>Edit Tenant</button>
                            <a href={`/sites/${restaurant.slug}`} target="_blank" rel="noreferrer">View Website</a>
                            <a href={`/restaurant/${restaurant.slug}`} target="_blank" rel="noreferrer">Open Restaurant Admin</a>
                            <button disabled={!apiOnline} onClick={() => toggleWebsite(restaurant)}>Website Settings</button>
                            <button disabled={!apiOnline} onClick={() => manageDomain(restaurant)}>Manage Domain</button>
                            <button disabled={!apiOnline} onClick={() => impersonate(restaurant)}>Impersonate</button>
                            {restaurant.status === "SUSPENDED" ? <button disabled={!apiOnline} onClick={() => activateRestaurant(restaurant)}>Activate</button> : <button disabled={!apiOnline} onClick={() => suspendRestaurant(restaurant)}>Suspend</button>}
                            {planCodes.map((plan) => <button disabled={!apiOnline} key={plan} onClick={() => assignPlan(restaurant, plan)}>Plan: {plan}</button>)}
                            <button disabled title="Delete is intentionally disabled. Suspend keeps audit history.">Delete placeholder</button>
                          </div>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="panel">
          <h3 className="panel-title">Audit logs</h3>
          <div className="mt-4 space-y-3">
            {auditLogs.length === 0 ? <EmptyState title="No audit logs" detail="Admin actions will appear here." /> : auditLogs.map((log) => (
              <div className="rounded-md border border-line p-3" key={log.id}>
                <p className="font-semibold text-ink">{log.action}</p>
                <p className="text-sm text-slate-500">{log.actor?.name || "System"} on {log.restaurant?.name || log.entityType}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
      {selectedTenant ? (
        <div className="modal-backdrop">
          <form className="tenant-modal form-grid" onSubmit={saveSelectedTenant}>
            <div className="md:col-span-3 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mint">Edit tenant</p>
                <h3 className="panel-title">{selectedTenant.businessName || selectedTenant.name}</h3>
              </div>
              <button className="button-muted" type="button" onClick={() => setSelectedTenant(null)}>Cancel</button>
            </div>
            <input className="input" value={selectedTenant.name} placeholder="Business name" onChange={(event) => setSelectedTenant({ ...selectedTenant, name: event.target.value })} />
            <input className="input" value={selectedTenant.businessName} placeholder="Public business name" onChange={(event) => setSelectedTenant({ ...selectedTenant, businessName: event.target.value })} />
            <input className="input" value={selectedTenant.slug} placeholder="slug" onChange={(event) => setSelectedTenant({ ...selectedTenant, slug: slugify(event.target.value) })} />
            <select className="select" value={selectedTenant.businessType} onChange={(event) => setSelectedTenant({ ...selectedTenant, businessType: event.target.value, enabledModules: moduleDefaultsFor(event.target.value) })}>
              {businessTypes.map((type) => <option value={type} key={type}>{readable(type)}</option>)}
            </select>
            <select className="select" value={selectedTenant.planCode} onChange={(event) => setSelectedTenant({ ...selectedTenant, planCode: event.target.value })}>
              {planCodes.map((plan) => <option key={plan}>{plan}</option>)}
            </select>
            <select className="select" value={selectedTenant.status} onChange={(event) => setSelectedTenant({ ...selectedTenant, status: event.target.value })}>
              <option>ACTIVE</option><option>PENDING</option><option>SUSPENDED</option>
            </select>
            <input className="input" value={selectedTenant.ownerEmail} placeholder="Owner email" disabled />
            <input className="input" value={selectedTenant.email} placeholder="Business email" onChange={(event) => setSelectedTenant({ ...selectedTenant, email: event.target.value })} />
            <input className="input" value={selectedTenant.phone} placeholder="Phone" onChange={(event) => setSelectedTenant({ ...selectedTenant, phone: event.target.value })} />
            <input className="input" value={selectedTenant.cuisineType} placeholder="Category/cuisine label" onChange={(event) => setSelectedTenant({ ...selectedTenant, cuisineType: event.target.value })} />
            <input className="input" value={selectedTenant.address} placeholder="Address" onChange={(event) => setSelectedTenant({ ...selectedTenant, address: event.target.value })} />
            <input className="input" value={selectedTenant.city} placeholder="City" onChange={(event) => setSelectedTenant({ ...selectedTenant, city: event.target.value })} />
            <input className="input" value={selectedTenant.state} placeholder="State" onChange={(event) => setSelectedTenant({ ...selectedTenant, state: event.target.value })} />
            <input className="input" value={selectedTenant.zip} placeholder="ZIP" onChange={(event) => setSelectedTenant({ ...selectedTenant, zip: event.target.value })} />
            <input className="input md:col-span-2" value={selectedTenant.customDomain} placeholder="Custom domain" onChange={(event) => setSelectedTenant({ ...selectedTenant, customDomain: event.target.value })} />
            <select className="select" value={selectedTenant.domainStatus} onChange={(event) => setSelectedTenant({ ...selectedTenant, domainStatus: event.target.value })}>
              <option>PENDING_VERIFICATION</option><option>VERIFIED</option><option>ACTIVE</option><option>ERROR</option>
            </select>
            <div className="md:col-span-3 flex flex-wrap gap-2">
              <label className="seg"><input type="checkbox" checked={selectedTenant.websiteEnabled} onChange={(event) => setSelectedTenant({ ...selectedTenant, websiteEnabled: event.target.checked })} />Website enabled</label>
              <label className="seg"><input type="checkbox" checked={selectedTenant.pickupEnabled} onChange={(event) => setSelectedTenant({ ...selectedTenant, pickupEnabled: event.target.checked })} />Pickup enabled</label>
              <label className="seg"><input type="checkbox" checked={selectedTenant.deliveryEnabled} onChange={(event) => setSelectedTenant({ ...selectedTenant, deliveryEnabled: event.target.checked })} />Delivery enabled</label>
            </div>
            <div className="md:col-span-3 flex flex-wrap gap-2">
              {businessModules.map((module) => (
                <button className={`seg ${selectedTenant.enabledModules.includes(module) ? "active" : ""}`} key={module} type="button" onClick={() => setSelectedTenant((current) => ({ ...current, enabledModules: current.enabledModules.includes(module) ? current.enabledModules.filter((item) => item !== module) : [...current.enabledModules, module] }))}>
                  {readable(module)}
                </button>
              ))}
            </div>
            <button className="button-primary" type="submit" disabled={!apiOnline || savingTenant}>{savingTenant ? "Saving tenant" : "Save tenant"}</button>
            <button className="button-muted" type="button" onClick={() => setSelectedTenant(null)}>Cancel</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function RestaurantApp({ apiOnline, token, user }) {
  const restaurantId = user?.restaurantId;
  const [profile, setProfile] = useState(demoRestaurant);
  const [stats, setStats] = useState({ ordersToday: demoOrders.length, pendingOrders: 2, activeDrivers: demoDrivers.filter((driver) => driver.available).length, sales: { amountCents: 9621, driverTipCents: 1500 } });
  const [categories, setCategories] = useState(demoRestaurant.categories);
  const [items, setItems] = useState(demoRestaurant.categories.flatMap((category) => category.items.map((item) => ({ ...item, category }))));
  const [orders, setOrders] = useState(demoOrders);
  const [drivers, setDrivers] = useState(demoDrivers);
  const [customers, setCustomers] = useState(demoCustomers);
  const [customerSummary, setCustomerSummary] = useState(demoCustomerSummary);
  const [loyalty, setLoyalty] = useState(demoGrowth.loyalty);
  const [promotions, setPromotions] = useState(demoGrowth.promotions);
  const [growthAnalytics, setGrowthAnalytics] = useState(demoGrowth.analytics);
  const [menuInsights, setMenuInsights] = useState(demoGrowth.menuInsights);
  const [locations, setLocations] = useState(demoGrowth.locations);
  const [website, setWebsite] = useState(demoWebsiteSettings);
  const [domain, setDomain] = useState(demoDomain);
  const [gallery, setGallery] = useState(demoGallery);
  const [socialLinks, setSocialLinks] = useState(demoSocialLinks);
  const [error, setError] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [itemForm, setItemForm] = useState({ categoryId: "", name: "", priceCents: 1295, preparationTimeMins: 15, description: "" });
  const publicSiteUrl = `/sites/${profile.slug || "demo-bistro"}`;

  async function loadRestaurant() {
    if (!apiOnline || !token || !restaurantId) return;
    setError("");
    try {
      const [dashboardPayload, profilePayload, categoriesPayload, itemsPayload, ordersPayload, driversPayload, customersPayload, customerSummaryPayload, loyaltyPayload, promotionsPayload, analyticsPayload, menuInsightsPayload, locationsPayload, websitePayload, domainPayload, galleryPayload, socialPayload] = await Promise.all([
        api(`/api/restaurants/${restaurantId}/dashboard`, { token }),
        api(`/api/restaurants/${restaurantId}/profile`, { token }),
        api(`/api/restaurants/${restaurantId}/menu/categories`, { token }),
        api(`/api/restaurants/${restaurantId}/menu/items`, { token }),
        api(`/api/restaurants/${restaurantId}/orders`, { token }),
        api(`/api/restaurants/${restaurantId}/drivers`, { token }),
        api(`/api/restaurants/${restaurantId}/customers`, { token }),
        api(`/api/restaurants/${restaurantId}/customers/summary`, { token }),
        api(`/api/restaurants/${restaurantId}/loyalty`, { token }),
        api(`/api/restaurants/${restaurantId}/promotions/analytics`, { token }),
        api(`/api/restaurants/${restaurantId}/analytics`, { token }),
        api(`/api/restaurants/${restaurantId}/menu/insights`, { token }),
        api(`/api/restaurants/${restaurantId}/locations`, { token }),
        api(`/api/restaurants/${restaurantId}/website`, { token }),
        api(`/api/restaurants/${restaurantId}/domain`, { token }),
        api(`/api/restaurants/${restaurantId}/gallery`, { token }),
        api(`/api/restaurants/${restaurantId}/social-links`, { token })
      ]);
      setStats(dashboardPayload);
      setProfile(profilePayload.restaurant || demoRestaurant);
      setCategories(categoriesPayload.categories || []);
      setItems(itemsPayload.items || []);
      setOrders(ordersPayload.orders || []);
      setDrivers(driversPayload.drivers || []);
      setCustomers(customersPayload.customers || []);
      setCustomerSummary(customerSummaryPayload);
      setLoyalty(loyaltyPayload);
      setPromotions(promotionsPayload);
      setGrowthAnalytics(analyticsPayload);
      setMenuInsights(menuInsightsPayload);
      setLocations(locationsPayload.locations || []);
      setWebsite(websitePayload.website || demoWebsiteSettings);
      setDomain(domainPayload.domain || demoDomain);
      setGallery(galleryPayload.gallery || []);
      setSocialLinks(socialPayload.socialLinks || []);
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  useEffect(() => {
    loadRestaurant();
  }, [apiOnline, token, restaurantId]);

  async function createCategory(event) {
    event.preventDefault();
    if (!apiOnline) return setCategories((current) => [...current, { id: categoryName, name: categoryName, items: [] }]);
    try {
      await api(`/api/restaurants/${restaurantId}/menu/categories`, { method: "POST", token, body: { name: categoryName, sortOrder: categories.length + 1 } });
      setCategoryName("");
      await loadRestaurant();
    } catch (createError) {
      setError(createError.message);
    }
  }

  async function deleteCategory(categoryId) {
    if (!apiOnline) return setCategories((current) => current.filter((category) => category.id !== categoryId));
    try {
      await api(`/api/restaurants/${restaurantId}/menu/categories/${categoryId}`, { method: "DELETE", token });
      await loadRestaurant();
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  async function createItem(event) {
    event.preventDefault();
    const payload = { ...itemForm, priceCents: Number(itemForm.priceCents), preparationTimeMins: Number(itemForm.preparationTimeMins), options: [] };
    if (!apiOnline) return setItems((current) => [...current, { ...payload, id: crypto.randomUUID(), available: true }]);
    try {
      await api(`/api/restaurants/${restaurantId}/menu/items`, { method: "POST", token, body: payload });
      setItemForm({ categoryId: categories[0]?.id || "", name: "", priceCents: 1295, preparationTimeMins: 15, description: "" });
      await loadRestaurant();
    } catch (createError) {
      setError(createError.message);
    }
  }

  async function updateItem(item, data) {
    if (!apiOnline) return setItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, ...data } : currentItem));
    try {
      await api(`/api/restaurants/${restaurantId}/menu/items/${item.id}`, { method: "PATCH", token, body: data });
      await loadRestaurant();
    } catch (updateError) {
      setError(updateError.message);
    }
  }

  async function deleteItem(itemId) {
    if (!apiOnline) return setItems((current) => current.filter((item) => item.id !== itemId));
    try {
      await api(`/api/restaurants/${restaurantId}/menu/items/${itemId}`, { method: "DELETE", token });
      await loadRestaurant();
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  async function updateOrderStatus(order, status) {
    if (!apiOnline) return setOrders((current) => current.map((currentOrder) => currentOrder.id === order.id ? { ...currentOrder, status } : currentOrder));
    try {
      await api(`/api/restaurants/${restaurantId}/orders/${order.id}/status`, { method: "PATCH", token, body: { status } });
      await loadRestaurant();
    } catch (statusError) {
      setError(statusError.message);
    }
  }

  async function assignDriver(order) {
    const driver = drivers[0];
    if (!driver) return setError("Create a driver before assigning delivery.");
    if (!apiOnline) return setOrders((current) => current.map((currentOrder) => currentOrder.id === order.id ? { ...currentOrder, delivery: { driver } } : currentOrder));
    try {
      await api(`/api/restaurants/${restaurantId}/orders/${order.id}/assign-driver`, { method: "POST", token, body: { driverId: driver.id } });
      await loadRestaurant();
    } catch (assignError) {
      setError(assignError.message);
    }
  }

  async function saveBranding() {
    if (!apiOnline) return;
    try {
      await api(`/api/restaurants/${restaurantId}/branding`, {
        method: "PATCH",
        token,
        body: {
          brandingJson: { primaryColor: "#1f9d80", accentColor: "#f4b740", bannerImageUrl: "/placeholder-banner.jpg", socialLinks: { instagram: "https://instagram.com/demo" } },
          storeHoursJson: { monday: "9:00 AM - 9:00 PM", tuesday: "9:00 AM - 9:00 PM" },
          phone: profile.phone,
          email: profile.email,
          address: profile.address
        }
      });
      await loadRestaurant();
    } catch (brandingError) {
      setError(brandingError.message);
    }
  }

  async function saveWebsiteSettings(data = website) {
    if (!apiOnline) return setWebsite(data);
    try {
      const payload = await api(`/api/restaurants/${restaurantId}/website`, { method: "PATCH", token, body: data });
      setWebsite(payload.website);
    } catch (websiteError) {
      setError(websiteError.message);
    }
  }

  async function saveDomain(data = domain) {
    if (!apiOnline) return setDomain(data);
    try {
      const payload = await api(`/api/restaurants/${restaurantId}/domain`, { method: "PATCH", token, body: data });
      setDomain(payload.domain);
    } catch (domainError) {
      setError(domainError.message);
    }
  }

  async function addGalleryPlaceholder() {
    const next = { imageUrl: `/media/${profile.slug || "restaurant"}/gallery-${gallery.length + 1}.jpg`, altText: `${profile.name} gallery image`, sortOrder: gallery.length + 1 };
    if (!apiOnline) return setGallery((current) => [...current, { ...next, id: crypto.randomUUID() }]);
    try {
      await api(`/api/restaurants/${restaurantId}/gallery`, { method: "POST", token, body: next });
      await loadRestaurant();
    } catch (galleryError) {
      setError(galleryError.message);
    }
  }

  async function addSocialPlaceholder() {
    const next = { platform: "instagram", url: `https://instagram.com/${(profile.slug || "restaurant").replaceAll("-", "")}` };
    if (!apiOnline) return setSocialLinks((current) => [...current, { ...next, id: crypto.randomUUID() }]);
    try {
      await api(`/api/restaurants/${restaurantId}/social-links`, { method: "POST", token, body: next });
      await loadRestaurant();
    } catch (socialError) {
      setError(socialError.message);
    }
  }

  const businessType = profile.businessType || "RESTAURANT";
  if (!isOrderingBusiness(businessType)) {
    const placeholder = { title: "Food catalog placeholder", detail: "This tenant type stays within food commerce, but full catalog ordering is planned after restaurant direct ordering and delivery are hardened." };

    return (
      <div className="space-y-6">
        <SectionHeader eyebrow={`${readable(businessType)} dashboard`} title={profile.businessName || profile.name || "Business"} icon={Store} action={<button className="button-muted" onClick={loadRestaurant}><RefreshCw size={18} />Refresh</button>} />
        <InlineError message={error} />
        <div className="grid gap-4 md:grid-cols-3">
          <Stat icon={Store} label="Food business type" value={readable(businessType)} detail="Restaurant-centric SaaS foundation" />
          <Stat icon={TicketPercent} label="Modules" value={(profile.enabledModules || []).length} detail={(profile.enabledModules || []).map(readable).join(", ") || "No modules"} />
          <Stat icon={Clock} label="Status" value={profile.status || "ACTIVE"} detail="Restaurant module remains production-ready" />
        </div>
        <div className="panel">
          <h3 className="panel-title">{placeholder.title}</h3>
          <p className="mt-3 text-sm text-slate-500">{placeholder.detail}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader eyebrow="Restaurant dashboard" title={apiOnline ? "Live restaurant operations" : "Demo Bistro operations"} icon={ChefHat} action={<button className="button-muted" onClick={loadRestaurant}><RefreshCw size={18} />Refresh</button>} />
      <InlineError message={error} />
      <div className="grid gap-4 md:grid-cols-4">
        <Stat icon={Clock} label="Pending orders" value={stats.pendingOrders ?? orders.filter((order) => !["DELIVERED", "CANCELLED"].includes(order.status)).length} detail="Live kitchen queue" />
        <Stat icon={ReceiptText} label="Today's sales" value={money(stats.sales?.amountCents || stats.sales?.restaurantNetCents || orders.reduce((sum, order) => sum + order.totalCents, 0))} detail="Tips separated" />
        <Stat icon={Truck} label="Available drivers" value={stats.activeDrivers ?? drivers.filter((driver) => driver.available).length} detail="Internal fleet" />
        <Stat icon={TicketPercent} label="Orders today" value={stats.ordersToday ?? orders.length} detail="Pickup and delivery" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="panel">
          <h3 className="panel-title">Menu management</h3>
          <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={createCategory}>
            <input className="input" placeholder="New category" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} />
            <button className="button-primary" type="submit"><Plus size={16} />Category</button>
          </form>
          <form className="mt-4 form-grid" onSubmit={createItem}>
            <select className="select" value={itemForm.categoryId} onChange={(event) => setItemForm({ ...itemForm, categoryId: event.target.value })}>
              <option value="">Select category</option>
              {categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
            </select>
            <input className="input" placeholder="Item name" value={itemForm.name} onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })} />
            <input className="input" type="number" placeholder="Price cents" value={itemForm.priceCents} onChange={(event) => setItemForm({ ...itemForm, priceCents: event.target.value })} />
            <input className="input" placeholder="Description" value={itemForm.description} onChange={(event) => setItemForm({ ...itemForm, description: event.target.value })} />
            <input className="input" type="number" placeholder="Prep minutes" value={itemForm.preparationTimeMins} onChange={(event) => setItemForm({ ...itemForm, preparationTimeMins: event.target.value })} />
            <button className="button-primary" type="submit"><MenuIcon size={16} />Create item</button>
          </form>
          <div className="mt-5 space-y-4">
            {categories.length === 0 ? <EmptyState title="No menu categories" detail="Add a category before creating menu items." /> : categories.map((category) => (
              <div key={category.id}>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="font-bold text-ink">{category.name}</h4>
                  <button className="button-muted" onClick={() => deleteCategory(category.id)}><Trash2 size={15} />Delete</button>
                </div>
                <div className="space-y-2">
                  {items.filter((item) => item.categoryId === category.id || item.category?.id === category.id).length === 0 ? <p className="text-sm text-slate-500">No items in this category.</p> : items.filter((item) => item.categoryId === category.id || item.category?.id === category.id).map((item) => (
                    <div className="menu-row" key={item.id}>
                      <div>
                        <p className="font-semibold text-ink">{item.name}</p>
                        <p className="text-sm text-slate-500">{item.preparationTimeMins} min prep - {item.available === false ? "Unavailable" : "Available"}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <strong>{money(item.priceCents)}</strong>
                        <button className="button-muted" onClick={() => updateItem(item, { available: !item.available })}>{item.available === false ? "Enable" : "Disable"}</button>
                        <button className="button-muted" onClick={() => deleteItem(item.id)}><Trash2 size={15} />Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <h3 className="panel-title">Live orders</h3>
          <div className="mt-4 space-y-3">
            {orders.length === 0 ? <EmptyState title="No orders yet" detail="Customer orders will appear here in real time." /> : orders.map((order) => (
              <div className="order-row" key={order.id}>
                <div>
                  <p className="font-bold text-ink">#{order.orderNumber} - {order.customer?.name || "Customer"}</p>
                  <p className="text-sm text-slate-500">{order.type} - Total {money(order.totalCents)} - Driver tip {money(order.tipCents)}</p>
                  {order.delivery?.driver?.user?.name ? <p className="text-xs text-slate-500">Driver: {order.delivery.driver.user.name}</p> : null}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <StatusPill tone={order.status === "DELIVERED" ? "good" : order.status === "READY" ? "warn" : "neutral"}>{order.status}</StatusPill>
                  {["ACCEPTED", "PREPARING", "READY", "PICKED_UP", "DELIVERED", "CANCELLED"].map((status) => <button className="button-muted" key={status} onClick={() => updateOrderStatus(order, status)}>{status.replaceAll("_", " ")}</button>)}
                  {order.type === "DELIVERY" ? <button className="button-primary" onClick={() => assignDriver(order)}><Truck size={16} />Assign</button> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Stat icon={Users} label="Customers" value={customerSummary.totalCustomers || customers.length} detail={`${customerSummary.newCustomersThisMonth || 0} new this month`} />
        <Stat icon={RefreshCw} label="Repeat rate" value={`${customerSummary.repeatCustomerPercentage || 0}%`} detail="Customers with orders" />
        <Stat icon={TicketPercent} label="VIP customers" value={customerSummary.vipCustomerCount || 0} detail="High-value guests" />
        <Stat icon={CreditCard} label="Average order" value={money(growthAnalytics.metrics?.averageOrderValueCents)} detail="All completed orders" />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="panel">
          <h3 className="panel-title">Customer CRM</h3>
          <div className="mt-4 space-y-3">
            {customers.length === 0 ? <EmptyState title="No customers yet" detail="Customer profiles appear after orders are placed." /> : customers.slice(0, 6).map((customerRow) => (
              <div className="menu-row" key={customerRow.id}>
                <div>
                  <p className="font-semibold text-ink">{customerRow.name}</p>
                  <p className="text-sm text-slate-500">{customerRow.email} - {readable(customerRow.segment || "NEW_CUSTOMER")}</p>
                </div>
                <div className="text-right">
                  <strong>{money(customerRow.lifetimeSpendCents)}</strong>
                  <p className="text-xs text-slate-500">{customerRow.totalOrders} orders - {customerRow.loyaltyPointBalance} pts</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <h3 className="panel-title">Loyalty program</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-md bg-slate-50 p-3"><p className="text-xs font-bold uppercase text-slate-500">Points issued</p><strong className="text-xl text-ink">{loyalty.analytics?.pointsIssued || 0}</strong></div>
            <div className="rounded-md bg-slate-50 p-3"><p className="text-xs font-bold uppercase text-slate-500">Redeemed</p><strong className="text-xl text-ink">{loyalty.analytics?.pointsRedeemed || 0}</strong></div>
            <div className="rounded-md bg-slate-50 p-3"><p className="text-xs font-bold uppercase text-slate-500">Rewards</p><strong className="text-xl text-ink">{loyalty.rewards?.length || 0}</strong></div>
          </div>
          <div className="mt-4 space-y-2">
            {(loyalty.rewards || []).length === 0 ? <p className="text-sm text-slate-500">Reward examples: free drink, free appetizer, discount coupon, free delivery.</p> : loyalty.rewards.map((reward) => (
              <div className="summary-line" key={reward.id}><span>{reward.name}</span><strong>{reward.pointsRequired} pts</strong></div>
            ))}
          </div>
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="panel">
          <h3 className="panel-title">Promotions</h3>
          <div className="mt-4 space-y-2">
            {(promotions.activePromotions || []).length === 0 ? <EmptyState title="No active promotions" detail="Create coupons for fixed discounts, percentage discounts, free delivery, or BOGO placeholders." /> : promotions.activePromotions.map((coupon) => (
              <div className="summary-line" key={coupon.id}><span>{coupon.code}</span><strong>{coupon.redeemedCount || 0} used</strong></div>
            ))}
          </div>
        </div>
        <div className="panel">
          <h3 className="panel-title">Restaurant analytics</h3>
          <div className="mt-4 space-y-2 text-sm text-slate-600">
            <div className="summary-line"><span>Total orders</span><strong>{growthAnalytics.metrics?.totalOrders || orders.length}</strong></div>
            <div className="summary-line"><span>Delivery orders</span><strong>{growthAnalytics.metrics?.deliveryOrders || 0}</strong></div>
            <div className="summary-line"><span>Pickup orders</span><strong>{growthAnalytics.metrics?.pickupOrders || 0}</strong></div>
            <div className="summary-line"><span>Driver tips</span><strong>{money(growthAnalytics.metrics?.driverTipsCents)}</strong></div>
          </div>
        </div>
        <div className="panel">
          <h3 className="panel-title">Menu insights</h3>
          <div className="mt-4 space-y-2">
            {(menuInsights.bestSellingItems || []).length === 0 ? <EmptyState title="No item insights yet" detail="Best sellers and weak performers appear after orders." /> : menuInsights.bestSellingItems.slice(0, 4).map((item) => (
              <div className="summary-line" key={item.id}><span>{item.name}</span><strong>{item.quantity} sold</strong></div>
            ))}
          </div>
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="panel">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
            <div>
              <h3 className="panel-title">Website Builder</h3>
              <p className="mt-2 text-sm text-slate-500">Manage the public restaurant website generated from this tenant.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a className="button-muted" href={publicSiteUrl}>Preview Website</a>
              <a className="button-muted" href={`${publicSiteUrl}/menu`}>Preview Menu</a>
              <a className="button-muted" href={`${publicSiteUrl}/order`}>Preview Order</a>
              <a className="button-muted" href={`${publicSiteUrl}/contact`}>Preview Contact</a>
              <a className="button-primary" href={publicSiteUrl} target="_blank" rel="noreferrer">Open Public Website</a>
              <button className="button-muted" onClick={() => navigator.clipboard?.writeText(`${window.location.origin}${publicSiteUrl}`)}>Copy Website Link</button>
            </div>
          </div>
          <div className="mt-4 form-grid">
            <label className="text-sm font-semibold text-slate-600">Website status
              <select className="select mt-1" value={website.websiteEnabled ? "enabled" : "disabled"} onChange={(event) => setWebsite({ ...website, websiteEnabled: event.target.value === "enabled" })}>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-600">Brand color
              <input className="input mt-1" value={website.brandColor || ""} onChange={(event) => setWebsite({ ...website, brandColor: event.target.value })} />
            </label>
            <label className="text-sm font-semibold text-slate-600">Accent color
              <input className="input mt-1" value={website.accentColor || ""} onChange={(event) => setWebsite({ ...website, accentColor: event.target.value })} />
            </label>
            <input className="input" placeholder="Homepage headline" value={website.heroTitle || ""} onChange={(event) => setWebsite({ ...website, heroTitle: event.target.value })} />
            <input className="input" placeholder="Homepage subtitle" value={website.heroSubtitle || ""} onChange={(event) => setWebsite({ ...website, heroSubtitle: event.target.value })} />
            <input className="input" placeholder="Tagline" value={website.tagline || ""} onChange={(event) => setWebsite({ ...website, tagline: event.target.value })} />
            <input className="input" placeholder="Cuisine type" value={website.cuisineType || ""} onChange={(event) => setWebsite({ ...website, cuisineType: event.target.value })} />
            <input className="input" placeholder="Special offer text" value={website.specialOfferText || ""} onChange={(event) => setWebsite({ ...website, specialOfferText: event.target.value })} />
            <input className="input" placeholder="Logo URL placeholder" value={website.logoUrl || ""} onChange={(event) => setWebsite({ ...website, logoUrl: event.target.value })} />
            <input className="input" placeholder="Hero banner URL placeholder" value={website.heroImageUrl || ""} onChange={(event) => setWebsite({ ...website, heroImageUrl: event.target.value })} />
            <input className="input" placeholder="SEO title" value={website.seoTitle || ""} onChange={(event) => setWebsite({ ...website, seoTitle: event.target.value })} />
            <textarea className="input min-h-24 md:col-span-3" placeholder="About story" value={website.aboutStory || ""} onChange={(event) => setWebsite({ ...website, aboutStory: event.target.value })} />
            <textarea className="input min-h-20 md:col-span-3" placeholder="SEO description" value={website.seoDescription || ""} onChange={(event) => setWebsite({ ...website, seoDescription: event.target.value })} />
          </div>
          <button className="button-primary mt-4" onClick={() => saveWebsiteSettings()}><Store size={16} />Save Website Settings</button>
        </div>
        <div className="panel">
          <h3 className="panel-title">Domain Management</h3>
          <div className="mt-4 space-y-2 text-sm text-slate-600">
            <div className="summary-line"><span>Default SaaS URL</span><strong>/sites/{domain.defaultSubdomain || profile.slug}</strong></div>
            <div className="summary-line"><span>Domain status</span><strong>{readable(domain.domainStatus || "NOT_CONFIGURED")}</strong></div>
            <div className="summary-line"><span>SSL status</span><strong>{readable(domain.sslStatus || "NOT_CONFIGURED")}</strong></div>
            <p className="rounded-md bg-slate-50 p-3 font-semibold text-ink">Point your CNAME record to: {domain.dnsTarget || "sites.loohar.com"}</p>
          </div>
          <div className="mt-4 grid gap-2">
            <input className="input" placeholder="Custom domain placeholder" value={domain.customDomain || ""} onChange={(event) => setDomain({ ...domain, customDomain: event.target.value })} />
            <button className="button-primary" onClick={() => saveDomain({ ...domain, domainStatus: "PENDING_VERIFICATION", sslStatus: "PENDING" })}>Save Domain Placeholder</button>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-bold text-ink">Gallery</h4>
                <button className="button-muted" onClick={addGalleryPlaceholder}><Plus size={15} />Image</button>
              </div>
              <div className="mt-2 space-y-2">{gallery.length === 0 ? <p className="text-sm text-slate-500">No gallery placeholders yet.</p> : gallery.slice(0, 4).map((image) => <div className="summary-line" key={image.id}><span>{image.altText}</span><strong>{image.sortOrder}</strong></div>)}</div>
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-bold text-ink">Social links</h4>
                <button className="button-muted" onClick={addSocialPlaceholder}><Plus size={15} />Link</button>
              </div>
              <div className="mt-2 space-y-2">{socialLinks.length === 0 ? <p className="text-sm text-slate-500">No social links yet.</p> : socialLinks.map((link) => <div className="summary-line" key={link.id}><span>{link.platform}</span><strong>Active</strong></div>)}</div>
            </div>
          </div>
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="panel">
          <h3 className="panel-title">Branding and settings</h3>
          <p className="mt-2 text-sm text-slate-500">Logo, banner image, brand colors, social links, contact info, and store hours use the restaurant profile settings.</p>
          <button className="button-primary mt-4" onClick={saveBranding}><Store size={16} />Save sample branding</button>
        </div>
        <div className="panel">
          <h3 className="panel-title">Multi-location foundation</h3>
          <p className="mt-2 text-sm text-slate-500">{locations.length} configured location records. Future support will separate menus, drivers, and reporting by location.</p>
        </div>
      </div>
    </div>
  );
}

function CustomerApp({ apiOnline, token, user, initialSlug = "demo-bistro", embedded = false }) {
  const [slug, setSlug] = useState(initialSlug);
  const [restaurant, setRestaurant] = useState(demoRestaurant);
  const [orderingEnabled, setOrderingEnabled] = useState(true);
  const [storefrontPlaceholder, setStorefrontPlaceholder] = useState(null);
  const [cart, setCart] = useState([]);
  const [serviceType, setServiceType] = useState("DELIVERY");
  const [customer, setCustomer] = useState({ name: "Maya Chen", email: "customer@demo.local", phone: "555-0166", deliveryAddress: "2425 Market St, Denver, CO" });
  const [orderStatus, setOrderStatus] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState(null);
  const [couponCode, setCouponCode] = useState("");
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedOptions, setSelectedOptions] = useState({});
  const [selectedQuantity, setSelectedQuantity] = useState(1);
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [history, setHistory] = useState([]);
  const [loyaltyPrograms, setLoyaltyPrograms] = useState([]);
  const [error, setError] = useState("");
  const subtotal = useMemo(() => cart.reduce((sum, item) => sum + (item.linePriceCents || item.priceCents) * item.quantity, 0), [cart]);
  const delivery = serviceType === "DELIVERY" ? restaurant.deliveryFeeCents || 0 : 0;
  const tax = Math.round(subtotal * 0.0825);
  const tip = serviceType === "DELIVERY" ? 500 : 0;

  async function loadMenu(targetSlug = slug) {
    if (!apiOnline) {
      setRestaurant(demoWebsiteBundle(targetSlug).restaurant);
      setOrderingEnabled(true);
      setStorefrontPlaceholder(null);
      return;
    }
    setError("");
    try {
      const payload = await api(`/api/customer/restaurants/${targetSlug}`);
      setRestaurant(normalizePublicRestaurant(payload));
      setOrderingEnabled(payload.orderingEnabled ?? isOrderingBusiness(payload.restaurant?.businessType));
      setStorefrontPlaceholder(payload.placeholder || null);
      setCart([]);
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  async function loadHistory() {
    if (!apiOnline || !token || user?.role !== "CUSTOMER") return;
    try {
      const payload = await api("/api/customer/me/orders", { token });
      setHistory(payload.orders || []);
      const loyaltyPayload = await api("/api/customer/me/loyalty", { token });
      setLoyaltyPrograms(loyaltyPayload.programs || []);
    } catch (historyError) {
      setError(historyError.message);
    }
  }

  useEffect(() => {
    setSlug(initialSlug);
    loadMenu(initialSlug);
  }, [initialSlug]);

  useEffect(() => {
    loadMenu();
  }, [apiOnline]);

  useEffect(() => {
    loadHistory();
  }, [apiOnline, token, user?.role]);

  function addItem(item) {
    if ((item.optionGroups || []).length > 0) {
      setSelectedItem(item);
      const defaults = {};
      (item.optionGroups || []).forEach((group) => {
        const defaultOptions = (group.options || []).filter((option) => option.isDefault);
        defaults[group.id || group.name] = group.maxSelect === 1 ? defaultOptions[0]?.name || "" : defaultOptions.map((option) => option.name);
      });
      setSelectedOptions(defaults);
      setSelectedQuantity(1);
      setSpecialInstructions("");
      return;
    }
    setCart((current) => {
      const existing = current.find((cartItem) => cartItem.id === item.id);
      if (existing) return current.map((cartItem) => cartItem.id === item.id ? { ...cartItem, quantity: cartItem.quantity + 1 } : cartItem);
      return [...current, { ...item, quantity: 1, menuItemId: item.id, lineId: crypto.randomUUID(), selectedModifiers: [] }];
    });
  }

  function toggleOption(group, option) {
    const key = group.id || group.name;
    setSelectedOptions((current) => {
      if (group.maxSelect === 1) return { ...current, [key]: option.name };
      const selected = Array.isArray(current[key]) ? current[key] : [];
      return selected.includes(option.name)
        ? { ...current, [key]: selected.filter((name) => name !== option.name) }
        : { ...current, [key]: [...selected, option.name].slice(0, group.maxSelect || 99) };
    });
  }

  function selectedModifierRows() {
    if (!selectedItem) return [];
    return (selectedItem.optionGroups || []).flatMap((group) => {
      const key = group.id || group.name;
      const selected = Array.isArray(selectedOptions[key]) ? selectedOptions[key] : [selectedOptions[key]].filter(Boolean);
      return (group.options || []).filter((option) => selected.includes(option.name)).map((option) => ({ group: group.name, name: option.name, priceCents: option.priceCents || 0 }));
    });
  }

  function addConfiguredItem() {
    if (!selectedItem) return;
    const modifiers = selectedModifierRows();
    const modifierTotal = modifiers.reduce((sum, option) => sum + option.priceCents, 0);
    setCart((current) => [...current, {
      ...selectedItem,
      quantity: selectedQuantity,
      menuItemId: selectedItem.id,
      lineId: crypto.randomUUID(),
      selectedModifiers: modifiers,
      specialInstructions,
      linePriceCents: selectedItem.priceCents + modifierTotal
    }]);
    setSelectedItem(null);
  }

  function updateCartQuantity(lineId, nextQuantity) {
    if (nextQuantity <= 0) return setCart((current) => current.filter((item) => (item.lineId || item.id) !== lineId));
    setCart((current) => current.map((item) => (item.lineId || item.id) === lineId ? { ...item, quantity: nextQuantity } : item));
  }

  function removeCartLine(lineId) {
    setCart((current) => current.filter((item) => (item.lineId || item.id) !== lineId));
  }

  async function placeOrder() {
    if (cart.length === 0) return setError("Add at least one item to the cart.");
    if (!orderingEnabled) return setError("Ordering is not enabled for this business type yet.");
    if (!apiOnline) {
      setOrderStatus({ id: "offline-order", orderNumber: "DEMO", status: "PENDING", totalCents: subtotal + delivery + tax + tip, statusHistory: [{ status: "PENDING" }] });
      setPaymentStatus({ status: "PENDING", provider: "stripe_placeholder" });
      return;
    }
    try {
      const payload = await api("/api/customer/orders", {
        method: "POST",
        body: {
          restaurantId: restaurant.id,
          customer: { name: customer.name, email: customer.email, phone: customer.phone },
          type: serviceType,
          deliveryAddress: serviceType === "DELIVERY" ? customer.deliveryAddress : undefined,
          tipCents: tip,
          couponCode: couponCode || undefined,
          items: cart.map((item) => ({ menuItemId: item.id, quantity: item.quantity, options: item.selectedModifiers || [] }))
        }
      });
      setOrderStatus(payload.order);
      setPaymentStatus(payload.payment);
      setCart([]);
      await loadHistory();
    } catch (orderError) {
      setError(orderError.message);
    }
  }

  async function refreshStatus(orderId) {
    if (!apiOnline || !orderId) return;
    try {
      const payload = await api(`/api/customer/orders/${orderId}/status`);
      setOrderStatus(payload.order);
    } catch (statusError) {
      setError(statusError.message);
    }
  }

  async function confirmPlaceholderPayment() {
    if (!apiOnline || !orderStatus?.id) return;
    try {
      const payload = await api(`/api/payments/placeholder/${orderStatus.id}/succeed`, { method: "POST" });
      setOrderStatus(payload.order);
      setPaymentStatus(payload.payment);
      await loadHistory();
    } catch (paymentError) {
      setError(paymentError.message);
    }
  }

  async function quickReorder(order) {
    if (!order?.items?.length) return;
    const draftItems = order.items.map((item) => ({ id: item.menuItemId, menuItemId: item.menuItemId, name: item.name, priceCents: item.unitPriceCents, quantity: item.quantity }));
    setCart(draftItems);
    setServiceType(order.type);
  }

  async function saveFavoriteOrder(order) {
    if (!apiOnline || !token) return setError("Sign in as a customer to save favorites.");
    try {
      await api("/api/customer/me/favorites", { method: "PATCH", token, body: { restaurantId: order.restaurantId, favoriteOrdersJson: [{ orderId: order.id, orderNumber: order.orderNumber }], favoriteItemsJson: order.items?.map((item) => ({ menuItemId: item.menuItemId, name: item.name })) || [] } });
    } catch (favoriteError) {
      setError(favoriteError.message);
    }
  }

  return (
    <div className="space-y-6">
      <InlineError message={error} />
      <div className={embedded ? "site-card" : "storefront"}>
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-mint">Direct ordering</p>
          <h2>{restaurant.name}</h2>
          <p>{restaurant.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {embedded ? null : <input className="input max-w-44" value={slug} onChange={(event) => setSlug(event.target.value)} />}
          {embedded ? null : <button className="button-muted" onClick={loadMenu}><Search size={16} />Load menu</button>}
          <button className={`seg ${serviceType === "DELIVERY" ? "active" : ""}`} onClick={() => setServiceType("DELIVERY")}><Truck size={17} />Delivery</button>
          <button className={`seg ${serviceType === "PICKUP" ? "active" : ""}`} onClick={() => setServiceType("PICKUP")}><PackageCheck size={17} />Pickup</button>
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          {!orderingEnabled ? (
            <section className="panel">
              <h3 className="panel-title">{storefrontPlaceholder?.module ? readable(storefrontPlaceholder.module) : "Future module placeholder"}</h3>
              <p className="mt-3 text-sm text-slate-500">{storefrontPlaceholder?.message || "This business type is supported by the SaaS foundation, but its customer workflow is not built yet."}</p>
            </section>
          ) : (restaurant.categories || []).length === 0 ? <EmptyState title="No public menu" detail="This business has not published orderable items yet." /> : restaurant.categories.map((category) => (
            <section className="panel" key={category.id}>
              <h3 className="panel-title">{category.name}</h3>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {(category.items || []).map((item) => (
                  <div className="food-card" key={item.id}>
                    {item.imageUrl ? <img className="order-card-img" src={item.imageUrl} alt={item.name} /> : null}
                    <div>
                      <p className="font-bold text-ink">{item.name}</p>
                      <p className="mt-1 text-sm text-slate-500">{item.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1">{dietaryBadges(item).map((badge) => <span className="diet-badge" key={badge}>{badge}</span>)}</div>
                      <p className="mt-3 font-bold text-mint">{money(item.priceCents)}</p>
                    </div>
                    <button className="button-primary h-fit" onClick={() => addItem(item)} aria-label={`Add ${item.name}`}><Plus size={16} />Add</button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
        <aside className="panel h-fit">
          <h3 className="panel-title">Cart and checkout</h3>
          <div className="mt-2 flex items-center justify-between text-sm text-slate-500">
            <span>{cart.reduce((sum, item) => sum + item.quantity, 0)} items in cart</span>
            {cart.length > 0 ? <button className="button-muted" onClick={() => setCart([])}>Clear cart</button> : null}
          </div>
          <div className="mt-4 grid gap-2">
            <input className="input" placeholder="Name" value={customer.name} onChange={(event) => setCustomer({ ...customer, name: event.target.value })} />
            <input className="input" placeholder="Email" value={customer.email} onChange={(event) => setCustomer({ ...customer, email: event.target.value })} />
            <input className="input" placeholder="Phone" value={customer.phone} onChange={(event) => setCustomer({ ...customer, phone: event.target.value })} />
            {serviceType === "DELIVERY" ? <input className="input" placeholder="Delivery address" value={customer.deliveryAddress} onChange={(event) => setCustomer({ ...customer, deliveryAddress: event.target.value })} /> : null}
            <input className="input" placeholder="Coupon code" value={couponCode} onChange={(event) => setCouponCode(event.target.value.toUpperCase())} />
          </div>
          <div className="mt-4 space-y-3">
            {cart.length === 0 ? <p className="text-sm text-slate-500">Add menu items to start an order.</p> : cart.map((item) => (
              <div className="rounded-md border border-line p-2" key={item.lineId || item.id}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-ink">{item.quantity}x {item.name}</span>
                  <span className="text-sm text-slate-600">{money((item.linePriceCents || item.priceCents) * item.quantity)}</span>
                </div>
                {(item.selectedModifiers || []).length > 0 ? <p className="mt-1 text-xs text-slate-500">{item.selectedModifiers.map((option) => `${option.group}: ${option.name}`).join(" / ")}</p> : null}
                {item.specialInstructions ? <p className="mt-1 text-xs text-slate-500">Note: {item.specialInstructions}</p> : null}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button className="button-muted" onClick={() => updateCartQuantity(item.lineId || item.id, item.quantity - 1)}>-</button>
                  <span className="rounded-md bg-slate-50 px-3 py-2 text-sm font-bold text-ink">{item.quantity}</span>
                  <button className="button-muted" onClick={() => updateCartQuantity(item.lineId || item.id, item.quantity + 1)}>+</button>
                  <button className="button-muted" onClick={() => removeCartLine(item.lineId || item.id)}>Remove</button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 border-t border-line pt-4 text-sm text-slate-600">
            <div className="summary-line"><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
            {orderStatus?.discountCents ? <div className="summary-line"><span>Discount</span><strong>-{money(orderStatus.discountCents)}</strong></div> : null}
            <div className="summary-line"><span>Delivery</span><strong>{money(delivery)}</strong></div>
            <div className="summary-line"><span>Tax</span><strong>{money(tax)}</strong></div>
            <div className="summary-line"><span>Driver tip</span><strong>{money(tip)}</strong></div>
            <div className="summary-line total"><span>Total</span><strong>{money(subtotal + delivery + tax + tip)}</strong></div>
          </div>
          <button className="button-primary mt-5 w-full justify-center" disabled={!orderingEnabled} onClick={placeOrder}><CreditCard size={18} />Place order</button>
          <div className="mt-5 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-ink">Order tracking</p>
              {orderStatus?.id ? <button className="button-muted" onClick={() => refreshStatus(orderStatus.id)}><RefreshCw size={15} />Refresh</button> : null}
            </div>
            {orderStatus ? <p className="mt-2">#{orderStatus.orderNumber} is {orderStatus.status}. Payment {paymentStatus?.status || "PENDING"}. Total {money(orderStatus.totalCents)}</p> : <p className="mt-1">Confirmation and live status appear after checkout.</p>}
            {paymentStatus?.provider === "stripe_placeholder" && paymentStatus.status !== "PAID" ? <button className="button-primary mt-3 w-full justify-center" onClick={confirmPlaceholderPayment}><CreditCard size={16} />Confirm placeholder payment</button> : null}
          </div>
          {history.length > 0 ? (
            <div className="mt-5">
              <h4 className="font-bold text-ink">Order history</h4>
              <div className="mt-2 space-y-2">
                {history.map((order) => (
                  <div className="rounded-md border border-line p-2" key={order.id}>
                    <button className="button-muted w-full justify-between" onClick={() => refreshStatus(order.id)}>#{order.orderNumber}<span>{order.status}</span></button>
                    <div className="mt-2 flex gap-2">
                      <button className="button-muted flex-1 justify-center" onClick={() => quickReorder(order)}>Quick reorder</button>
                      <button className="button-muted flex-1 justify-center" onClick={() => saveFavoriteOrder(order)}>Save favorite</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {selectedItem ? (
            <div className="modal-backdrop">
              <div className="item-modal">
                <img src={selectedItem.imageUrl} alt={selectedItem.name} />
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3>{selectedItem.name}</h3>
                      <p>{selectedItem.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1">{dietaryBadges(selectedItem).map((badge) => <span className="diet-badge" key={badge}>{badge}</span>)}</div>
                    </div>
                    <button className="button-muted" onClick={() => setSelectedItem(null)}>Close</button>
                  </div>
                  <div className="mt-4 space-y-4">
                    {(selectedItem.optionGroups || []).map((group) => (
                      <div className="rounded-md border border-line p-3" key={group.id || group.name}>
                        <p className="font-bold text-ink">{group.name} {group.required ? <span className="text-xs text-rose-600">Required</span> : null}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {(group.options || []).map((option) => {
                            const key = group.id || group.name;
                            const selected = Array.isArray(selectedOptions[key]) ? selectedOptions[key].includes(option.name) : selectedOptions[key] === option.name;
                            return <button className={`seg ${selected ? "active" : ""}`} key={option.id || option.name} onClick={() => toggleOption(group, option)}>{option.name}{option.priceCents ? ` +${money(option.priceCents)}` : ""}</button>;
                          })}
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <button className="button-muted" onClick={() => setSelectedQuantity(Math.max(1, selectedQuantity - 1))}>-</button>
                      <strong className="px-3">{selectedQuantity}</strong>
                      <button className="button-muted" onClick={() => setSelectedQuantity(selectedQuantity + 1)}>+</button>
                    </div>
                    <textarea className="input min-h-20" placeholder="Special instructions" value={specialInstructions} onChange={(event) => setSpecialInstructions(event.target.value)} />
                    <button className="button-primary w-full justify-center" onClick={addConfiguredItem}>Add to cart - {money((selectedItem.priceCents + selectedModifierRows().reduce((sum, option) => sum + option.priceCents, 0)) * selectedQuantity)}</button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          {loyaltyPrograms.length > 0 ? (
            <div className="mt-5 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
              <p className="font-semibold text-ink">Loyalty</p>
              {loyaltyPrograms.map((program) => (
                <div className="summary-line" key={program.restaurant.id}><span>{program.restaurant.name}</span><strong>{program.currentPoints} pts</strong></div>
              ))}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function DriverApp({ apiOnline, token }) {
  const [available, setAvailable] = useState(true);
  const [deliveries, setDeliveries] = useState([]);
  const [earnings, setEarnings] = useState({ deliveries: 3, earnings: 8600, tips: 4200 });
  const [error, setError] = useState("");
  const fallbackDelivery = { id: "demo-delivery", status: "ASSIGNED", pickupAddress: "Demo Bistro, 100 Main St", dropoffAddress: "2425 Market St, Denver", tipCents: 600, baseEarningsCents: 650, order: { orderNumber: "894120", customer: { name: "Maya Chen" }, restaurant: demoRestaurant, items: [] } };
  const shownDeliveries = deliveries.length > 0 ? deliveries : apiOnline ? [] : [fallbackDelivery];
  const statuses = ["ACCEPTED", "ARRIVED_AT_RESTAURANT", "PICKED_UP", "ON_THE_WAY", "DELIVERED"];

  async function loadDriver() {
    if (!apiOnline || !token) return;
    setError("");
    try {
      const [deliveryPayload, earningsPayload] = await Promise.all([
        api("/api/driver/deliveries", { token }),
        api("/api/driver/earnings", { token })
      ]);
      setDeliveries(deliveryPayload.deliveries || []);
      setEarnings(earningsPayload);
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  useEffect(() => {
    loadDriver();
  }, [apiOnline, token]);

  async function toggleAvailability() {
    const next = !available;
    setAvailable(next);
    if (!apiOnline || !token) return;
    try {
      await api("/api/driver/availability", { method: "PATCH", token, body: { available: next } });
    } catch (availabilityError) {
      setError(availabilityError.message);
    }
  }

  async function acceptDelivery(delivery) {
    if (!apiOnline) return setDeliveries((current) => current.map((item) => item.id === delivery.id ? { ...item, status: "ACCEPTED" } : item));
    try {
      await api(`/api/driver/deliveries/${delivery.id}/accept`, { method: "POST", token });
      await loadDriver();
    } catch (acceptError) {
      setError(acceptError.message);
    }
  }

  async function updateDeliveryStatus(delivery, status) {
    if (!apiOnline) return setDeliveries((current) => current.map((item) => item.id === delivery.id ? { ...item, status } : item));
    try {
      await api(`/api/driver/deliveries/${delivery.id}/status`, { method: "PATCH", token, body: { status } });
      await loadDriver();
    } catch (statusError) {
      setError(statusError.message);
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeader eyebrow="Driver PWA" title="Assigned delivery workflow" icon={Bike} action={<button className={`button-primary ${available ? "" : "opacity-70"}`} onClick={toggleAvailability}><Activity size={18} />{available ? "Available" : "Unavailable"}</button>} />
      <InlineError message={error} />
      <div className="grid gap-4 md:grid-cols-3">
        <Stat icon={ReceiptText} label="Earnings" value={money(earnings.earnings)} detail="Base delivery pay" />
        <Stat icon={CreditCard} label="Tips" value={money(earnings.tips)} detail="Tracked separately" />
        <Stat icon={CheckCircle2} label="Completed" value={earnings.deliveries || 0} detail="Delivery history" />
      </div>
      {shownDeliveries.length === 0 ? <EmptyState title="No assigned deliveries" detail="Restaurant-assigned delivery orders will appear here." /> : shownDeliveries.map((delivery) => (
        <div className="grid gap-5 lg:grid-cols-[1fr_0.8fr]" key={delivery.id}>
          <div className="panel">
            <h3 className="panel-title">Delivery #{delivery.order?.orderNumber || delivery.id}</h3>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="route-box"><Store size={20} /><div><strong>Pickup</strong><span>{delivery.pickupAddress || delivery.order?.restaurant?.address}</span></div></div>
              <div className="route-box"><MapPin size={20} /><div><strong>Dropoff</strong><span>{delivery.dropoffAddress}</span></div></div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button className="seg active" onClick={() => acceptDelivery(delivery)}>Accept delivery</button>
              {statuses.map((item) => (
                <button className={`seg ${delivery.status === item ? "active" : ""}`} key={item} onClick={() => updateDeliveryStatus(delivery, item)}>{item.replaceAll("_", " ")}</button>
              ))}
            </div>
            <div className="mt-5 rounded-md border border-line p-4">
              <p className="font-bold text-ink">Status: {delivery.status.replaceAll("_", " ")}</p>
              <p className="mt-1 text-sm text-slate-500">Customer: {delivery.order?.customer?.name || "Customer"} - Tip {money(delivery.tipCents)}</p>
            </div>
          </div>
          <div className="panel">
            <h3 className="panel-title">Delivery details</h3>
            <div className="mt-4 space-y-3">
              {(delivery.order?.items || []).length === 0 ? <EmptyState title="No item detail" detail="Order item details load with assigned deliveries." /> : delivery.order.items.map((item) => (
                <div className="rounded-md bg-slate-50 p-3 text-sm font-semibold text-slate-700" key={item.id}>{item.quantity}x {item.name}</div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const initialPath = window.location.pathname;
  const [active, setActive] = useState(initialPath.startsWith("/admin") ? "admin" : initialPath.startsWith("/restaurant") ? "restaurant" : "customer");
  const [token, setToken] = useState(() => localStorage.getItem("accessToken") || "");
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem("user");
    return stored ? JSON.parse(stored) : null;
  });
  const [apiOnline, setApiOnline] = useState(false);
  const isDriverRoute = window.location.pathname === "/driver" || window.location.pathname.startsWith("/driver/");
  const isAdminRoute = window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/");
  const isRestaurantRoute = window.location.pathname === "/restaurant" || window.location.pathname.startsWith("/restaurant/");
  const isSiteAdminRoute = /^\/sites\/[^/]+\/admin\/?$/.test(window.location.pathname);
  const isSiteRoute = (window.location.pathname === "/sites" || window.location.pathname.startsWith("/sites/")) && !isSiteAdminRoute;
  const orderRouteSlug = window.location.pathname.startsWith("/order/") ? window.location.pathname.split("/")[2] : null;

  useEffect(() => {
    checkApiHealth()
      .then(() => setApiOnline(true))
      .catch(() => setApiOnline(false));
  }, []);

  useEffect(() => {
    if (user?.role) setActive(roleDefaultTab(user.role));
  }, [user?.role]);

  function handleLogin(payload) {
    setToken(payload.accessToken);
    setUser(payload.user);
    localStorage.setItem("accessToken", payload.accessToken);
    localStorage.setItem("user", JSON.stringify(payload.user));
  }

  function handleImpersonate(payload) {
    handleLogin({ accessToken: payload.accessToken, user: payload.user });
    setActive("restaurant");
  }

  function logout() {
    setToken("");
    setUser(null);
    localStorage.removeItem("accessToken");
    localStorage.removeItem("user");
    setActive("customer");
  }

  const ActiveIcon = tabs.find((tab) => tab.id === active)?.icon || LayoutDashboard;

  if (isDriverRoute) {
    return <DriverPwaApp apiOnline={apiOnline} />;
  }

  if (isAdminRoute) {
    return (
      <div className="min-h-screen bg-[#f7f8fb] text-slate-700">
        <header className="border-b border-line bg-white">
          <div className="mx-auto max-w-7xl px-4 py-4">
            <h1 className="text-xl font-bold text-ink">Loohar Platform Owner Dashboard</h1>
            <p className="text-sm text-slate-500">Master Admin for restaurant tenants, plans, domains, and platform operations.</p>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">
          <LoginStrip apiOnline={apiOnline} token={token} user={user} onLogin={handleLogin} onLogout={logout} setActive={setActive} />
          <div className="my-4 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <StatusPill tone={apiOnline ? "good" : "warn"}>{apiOnline ? "API online" : "Offline demo fallback"}</StatusPill>
            <StatusPill tone={user?.role === "SUPER_ADMIN" ? "good" : "warn"}>{user?.role === "SUPER_ADMIN" ? "Super admin" : "Super admin login required"}</StatusPill>
          </div>
          {user?.role === "SUPER_ADMIN" || !apiOnline ? <AdminApp apiOnline={apiOnline} token={token} onImpersonate={handleImpersonate} /> : <InlineError message="This route is only for the platform owner." />}
        </main>
      </div>
    );
  }

  if (isRestaurantRoute || isSiteAdminRoute) {
    return (
      <div className="min-h-screen bg-[#f7f8fb] text-slate-700">
        <header className="border-b border-line bg-white">
          <div className="mx-auto max-w-7xl px-4 py-4">
            <h1 className="text-xl font-bold text-ink">{user?.restaurantName || "Restaurant Admin Portal"}</h1>
            <p className="text-sm text-slate-500">Owner and staff dashboard for menu, orders, drivers, customers, loyalty, coupons, branding, and reports.</p>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">
          <LoginStrip apiOnline={apiOnline} token={token} user={user} onLogin={handleLogin} onLogout={logout} setActive={setActive} />
          <div className="my-4 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <StatusPill tone={apiOnline ? "good" : "warn"}>{apiOnline ? "API online" : "Offline demo fallback"}</StatusPill>
            <StatusPill tone={["RESTAURANT_OWNER", "RESTAURANT_MANAGER", "KITCHEN_STAFF", "SUPER_ADMIN"].includes(user?.role) ? "good" : "warn"}>{user?.role || "Restaurant login required"}</StatusPill>
          </div>
          {["RESTAURANT_OWNER", "RESTAURANT_MANAGER", "KITCHEN_STAFF", "SUPER_ADMIN"].includes(user?.role) || !apiOnline ? <RestaurantApp apiOnline={apiOnline} token={token} user={user} /> : <InlineError message="This route is only for restaurant owners and staff." />}
        </main>
      </div>
    );
  }

  if (isSiteRoute) {
    return <PremiumRestaurantSite apiOnline={apiOnline} />;
  }

  if (orderRouteSlug) {
    return (
      <div className="min-h-screen bg-[#f7f8fb] px-4 py-6 text-slate-700">
        <main className="mx-auto max-w-7xl">
          <CustomerApp apiOnline={apiOnline} token={token} user={user} initialSlug={orderRouteSlug} embedded />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f8fb] text-slate-700">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-md bg-ink text-white"><ActiveIcon size={22} /></div>
            <div>
              <h1 className="text-xl font-bold text-ink">Restaurant Ordering SaaS</h1>
              <p className="text-sm text-slate-500">Multi-tenant ordering, delivery, staff, loyalty, and platform management.</p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-2">
            {tabs.map(({ id, label, icon: Icon }) => {
              const disabled = !canOpenTab(user, id, apiOnline);
              return (
                <button className={`nav-tab ${active === id ? "active" : ""}`} key={id} disabled={disabled} onClick={() => setActive(id)}>
                  <Icon size={17} />{label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <LoginStrip apiOnline={apiOnline} token={token} user={user} onLogin={handleLogin} onLogout={logout} setActive={setActive} />
        <div className="my-4 flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <StatusPill tone={apiOnline ? "good" : "warn"}>{apiOnline ? "API online" : "Offline demo fallback"}</StatusPill>
          <StatusPill tone={token ? "good" : "neutral"}>{token ? "JWT session active" : "Public session"}</StatusPill>
          <span>Seed logins: admin@platform.local, owner@demobistro.local, driver@demobistro.local, customer@demo.local</span>
        </div>
        {active === "admin" ? <AdminApp apiOnline={apiOnline} token={token} onImpersonate={handleImpersonate} /> : null}
        {active === "restaurant" ? <RestaurantApp apiOnline={apiOnline} token={token} user={user} /> : null}
        {active === "customer" ? <CustomerApp apiOnline={apiOnline} token={token} user={user} /> : null}
        {active === "driver" ? <DriverPwaApp apiOnline={apiOnline} token={token} /> : null}
      </main>
    </div>
  );
}
