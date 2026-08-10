import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  Clock,
  CreditCard,
  History,
  LockKeyhole,
  MonitorCog,
  Minus,
  PauseCircle,
  Play,
  Plus,
  ReceiptText,
  RefreshCw,
  Repeat2,
  Search,
  Settings2,
  ShoppingBag,
  SlidersHorizontal,
  Store,
  Trash2,
  UnlockKeyhole,
  UserRound,
  WalletCards,
  Wifi,
  WifiOff
} from "lucide-react";
import { canModifyPosItem, shouldOpenCustomization } from "./customization.js";

function money(cents = 0) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);
}

export function PosScreenHeader({ eyebrow, title, detail, onBack, actions }) {
  return (
    <header className="pos-workflow-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2>{title}</h2>
        {detail ? <p>{detail}</p> : null}
      </div>
      <div className="pos-workflow-header-actions">
        {onBack ? <button className="button-muted" type="button" onClick={onBack}><ArrowLeft size={18} />Back</button> : null}
        {actions}
      </div>
    </header>
  );
}

export function PosBootScreen({ restaurantName = "Restaurant" }) {
  return (
    <section className="pos-boot-screen" aria-live="polite" aria-busy="true">
      <div className="pos-boot-mark"><Store size={30} /></div>
      <h2>Preparing {restaurantName} POS</h2>
      <p>Loading this register, menu, shift, and payment readiness.</p>
      <div className="pos-boot-lines" aria-hidden="true"><span /><span /><span /></div>
    </section>
  );
}

export function PosOfflineScreen({ hasDraft, onRetry }) {
  return (
    <section className="pos-centered-screen" role="status">
      <WifiOff size={40} />
      <h2>Register is offline</h2>
      <p>{hasDraft ? "Your active order is preserved on this device. Reconnect before quoting, payment, or Kitchen submission." : "Reconnect to the Loohar API before starting an order."}</p>
      <button className="button-primary" type="button" onClick={onRetry}><RefreshCw size={18} />Try again</button>
    </section>
  );
}

export function RegisterLockScreen({ restaurant, device, shift, online, now, onBegin }) {
  const formattedTime = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(now);
  const formattedDate = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(now);
  return (
    <button className="pos-lock-screen" type="button" onClick={onBegin} aria-label="Tap to unlock register">
      <div className="pos-lock-brand"><Store size={36} /><span>{restaurant?.name || "Restaurant"}</span></div>
      <div className="pos-lock-clock"><strong>{formattedTime}</strong><span>{formattedDate}</span></div>
      <div className="pos-lock-details">
        <span>{device?.name || "Register"}</span>
        <span>{device?.location?.name || restaurant?.locations?.[0]?.name || "Primary location"}</span>
        <span className={online ? "good" : "warn"}>{online ? <Wifi size={17} /> : <WifiOff size={17} />}{online ? "Online" : "Offline"}</span>
        <span>{shift?.status === "OPEN" ? "Shift open" : "Shift closed"}</span>
      </div>
      <span className="pos-touch-unlock"><UnlockKeyhole size={22} />Tap to unlock</span>
    </button>
  );
}

export function CashierPinScreen({ pin, setPin, error, lockedUntil, saving, onSubmit, onCancel }) {
  const disabled = saving || pin.length < 4 || Boolean(lockedUntil);
  return (
    <section className="pos-pin-screen">
      <LockKeyhole size={38} />
      <h2>Cashier sign in</h2>
      <p>Enter your personal POS PIN. Five failed attempts temporarily lock this account.</p>
      {error ? <div className="pos-alert" role="alert">{error}</div> : null}
      {lockedUntil ? <div className="pos-alert" role="alert">PIN entry is locked until {new Date(lockedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</div> : null}
      <form className="pos-pin-form" onSubmit={onSubmit}>
        <label>
          <span>POS PIN</span>
          <input value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" autoComplete="off" type="password" name="pos-pin" aria-label="POS PIN" autoFocus />
        </label>
        <button className="button-primary" type="submit" disabled={disabled}><UnlockKeyhole size={18} />{saving ? "Checking..." : "Unlock register"}</button>
        <button className="button-muted" type="button" onClick={onCancel}>Cancel</button>
      </form>
    </section>
  );
}

export function RegisterHomeScreen({ restaurant, device, shift, heldCount, openCount, recentCount, onNewOrder, onHeld, onOpen, onRecent, onReprint, onShift, onSettings, onManager, onLock }) {
  const actions = [
    { label: "New order", detail: "Start dine-in, takeout, delivery, or walk-in service.", icon: ShoppingBag, action: onNewOrder, primary: true },
    { label: "Held orders", detail: `${heldCount || 0} waiting`, icon: PauseCircle, action: onHeld },
    { label: "Open orders", detail: `${openCount || 0} in progress`, icon: ReceiptText, action: onOpen },
    { label: "Recent orders", detail: `${recentCount || 0} today`, icon: History, action: onRecent },
    { label: "Reprint receipt", detail: "Find a completed order", icon: ReceiptText, action: onReprint },
    { label: "Shift", detail: shift?.status === "OPEN" ? "Open" : "Closed", icon: Clock, action: onShift },
    { label: "Register settings", detail: device?.name || "Configure register", icon: MonitorCog, action: onSettings },
    { label: "Manager actions", detail: "Protected controls", icon: LockKeyhole, action: onManager }
  ];
  return (
    <section className="pos-home-screen">
      <PosScreenHeader eyebrow={restaurant?.name || "Restaurant"} title="Register home" detail="Choose a task to continue." actions={<button className="button-muted" type="button" onClick={onLock}><LockKeyhole size={18} />Lock</button>} />
      <div className="pos-home-grid">
        {actions.map(({ label, detail, icon: Icon, action, primary }) => (
          <button className={`pos-home-action${primary ? " primary" : ""}`} type="button" onClick={action} key={label}>
            <Icon size={26} />
            <strong>{label}</strong>
            <span>{detail}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

const orderTypes = [
  ["WALK_IN", "Walk-in"],
  ["DINE_IN", "Dine-in"],
  ["PICKUP", "Pickup"],
  ["DELIVERY", "Delivery"],
  ["DRIVE_THRU", "Drive-thru"],
  ["CURBSIDE", "Curbside"],
  ["CATERING", "Catering"]
];

const ORDER_SETUP_FIELDS = {
  WALK_IN: [
    { key: "name", label: "Guest identifier", placeholder: "Walk-in guest", mode: "OPTIONAL" },
    { key: "phone", label: "Phone", inputMode: "tel", mode: "OPTIONAL" }
  ],
  DINE_IN: [
    { key: "tableNumber", label: "Table", placeholder: "Table 12", mode: "REQUIRED", root: true },
    { key: "seat", label: "Seat", placeholder: "Seat 2", mode: "OPTIONAL" },
    { key: "server", label: "Server", mode: "REQUIRED" },
    { key: "guestCount", label: "Guest count", type: "number", inputMode: "numeric", min: "1", mode: "REQUIRED" },
    { key: "name", label: "Guest name", mode: "OPTIONAL" }
  ],
  PICKUP: [
    { key: "name", label: "Pickup name", mode: "REQUIRED" },
    { key: "phone", label: "Phone", inputMode: "tel", mode: "REQUIRED" },
    { key: "pickupTime", label: "Pickup time", type: "datetime-local", mode: "REQUIRED" }
  ],
  DELIVERY: [
    { key: "name", label: "Customer name", mode: "REQUIRED" },
    { key: "phone", label: "Phone", inputMode: "tel", mode: "REQUIRED" },
    { key: "deliveryAddress", label: "Delivery address", mode: "REQUIRED", wide: true },
    { key: "deliveryInstructions", label: "Delivery instructions", mode: "OPTIONAL", wide: true }
  ],
  DRIVE_THRU: [
    { key: "vehicle", label: "Vehicle identifier", placeholder: "Blue SUV", mode: "REQUIRED" },
    { key: "name", label: "Order name", mode: "REQUIRED" },
    { key: "phone", label: "Phone", inputMode: "tel", mode: "OPTIONAL" }
  ],
  CURBSIDE: [
    { key: "name", label: "Pickup name", mode: "REQUIRED" },
    { key: "phone", label: "Phone", inputMode: "tel", mode: "REQUIRED" },
    { key: "vehicle", label: "Vehicle", placeholder: "Blue SUV", mode: "REQUIRED" },
    { key: "parkingSpot", label: "Parking spot", placeholder: "Spot 4", mode: "REQUIRED" }
  ],
  CATERING: [
    { key: "eventName", label: "Event name", mode: "REQUIRED" },
    { key: "name", label: "Contact name", mode: "REQUIRED" },
    { key: "phone", label: "Phone", inputMode: "tel", mode: "REQUIRED" },
    { key: "eventDateTime", label: "Event date and time", type: "datetime-local", mode: "REQUIRED" },
    { key: "headcount", label: "Headcount", type: "number", inputMode: "numeric", min: "1", mode: "REQUIRED" }
  ]
};

function setupFieldMode(policy, orderType, field) {
  const configured = String(policy?.[orderType]?.[field.key] || field.mode || "OPTIONAL").toUpperCase();
  return ["REQUIRED", "OPTIONAL", "HIDDEN"].includes(configured) ? configured : field.mode;
}

export function NewOrderSetupScreen({
  orderType,
  setOrderType,
  customer,
  setCustomer,
  tableNumber,
  setTableNumber,
  notes,
  setNotes,
  locations,
  locationId,
  setLocationId,
  deliveryZones = [],
  orderFieldPolicy = {},
  onStart,
  onBack
}) {
  const updateCustomer = (key, value) => setCustomer((current) => ({ ...current, [key]: value }));
  const fields = ORDER_SETUP_FIELDS[orderType] || ORDER_SETUP_FIELDS.WALK_IN;
  const startOrder = (event) => {
    event.preventDefault();
    onStart();
  };
  const skipWalkInDetails = () => {
    setCustomer((current) => ({ ...current, name: "Walk-in guest", phone: "" }));
    onStart();
  };

  return (
    <section className="pos-workflow-screen">
      <PosScreenHeader eyebrow="New order" title="Set up the order" detail="Choose service type first. Customer details can be added now or later." onBack={onBack} />
      <form onSubmit={startOrder}>
        <div className="pos-order-type-grid" role="radiogroup" aria-label="Order type">
          {orderTypes.map(([value, label]) => <button type="button" role="radio" aria-checked={orderType === value} className={orderType === value ? "active" : ""} onClick={() => setOrderType(value)} key={value}>{label}</button>)}
        </div>
        <div className="pos-setup-fields">
          {locations?.length > 1 ? <label><span>Location</span><select value={locationId} onChange={(event) => setLocationId(event.target.value)} required>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label> : null}
          {fields.map((field) => {
            const mode = setupFieldMode(orderFieldPolicy, orderType, field);
            if (mode === "HIDDEN") return null;
            const value = field.root ? tableNumber : customer[field.key] || "";
            const onChange = (event) => field.root ? setTableNumber(event.target.value) : updateCustomer(field.key, event.target.value);
            return (
              <label className={field.wide ? "wide" : ""} key={field.key}>
                <span>{field.label}{mode === "OPTIONAL" ? " (optional)" : ""}</span>
                <input type={field.type || "text"} value={value} onChange={onChange} placeholder={field.placeholder || ""} inputMode={field.inputMode} min={field.min} required={mode === "REQUIRED"} />
              </label>
            );
          })}
          {orderType === "DELIVERY" && deliveryZones.length ? (
            <label>
              <span>Delivery zone</span>
              <select value={customer.deliveryZoneId || ""} onChange={(event) => updateCustomer("deliveryZoneId", event.target.value)} required>
                <option value="">Select a delivery zone</option>
                {deliveryZones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name} · {money(zone.deliveryFeeCents)}</option>)}
              </select>
            </label>
          ) : null}
          <label className="wide"><span>{orderType === "CATERING" ? "Event notes (optional)" : "Order notes (optional)"}</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows="3" maxLength="1000" /></label>
        </div>
        <div className="pos-workflow-actions">
          {orderType === "WALK_IN" ? <button className="button-muted" type="button" onClick={skipWalkInDetails}>Skip guest details</button> : null}
          <button className="button-primary" type="submit"><Play size={18} />Start order</button>
        </div>
      </form>
    </section>
  );
}

export function OrderEntryScreen({
  items,
  menuItems,
  categories,
  selectedCategory,
  setSelectedCategory,
  searchQuery,
  setSearchQuery,
  cart,
  cartItemCount,
  cartTotalCents,
  mobileCartOpen,
  setMobileCartOpen,
  onAdd,
  onRepeat,
  onIncrease,
  onDecrease,
  onModify,
  onRemove,
  onClear,
  onPay,
  onHold,
  onHome,
  saving,
  emptyTitle,
  emptyDetail,
  onImageError
}) {
  const menuItemById = new Map((menuItems || items).map((item) => [item.id, item]));
  return (
    <section className="pos-entry-screen">
      <PosScreenHeader eyebrow="Current order" title="Order entry" detail="Choose items, review the current order, and continue to payment." onBack={onHome} />
      <div className="pos-entry-layout">
        <div className="pos-entry-menu">
          <div className="pos-entry-toolbar">
            <label><Search size={18} /><span className="sr-only">Search menu</span><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search menu" /></label>
            <select value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)} aria-label="Menu category"><option value="all">All categories</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select>
          </div>
          <div className="pos-entry-categories" aria-label="Menu categories"><button type="button" className={selectedCategory === "all" ? "active" : ""} onClick={() => setSelectedCategory("all")}>All</button>{categories.map((category) => <button type="button" className={selectedCategory === category.id ? "active" : ""} onClick={() => setSelectedCategory(category.id)} key={category.id}>{category.name}</button>)}</div>
          {items.length ? <div className="pos-entry-items">{items.map((item) => <button type="button" onClick={() => onAdd(item)} key={item.id}>{item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" onError={onImageError} /> : <span className="pos-entry-item-fallback"><Store size={22} /></span>}<span className="pos-entry-item-copy"><strong>{item.name}</strong><small>{item.categoryName || "Menu"}</small></span><b>{money(item.priceCents)}</b>{shouldOpenCustomization(item) ? <em className="pos-entry-customize-badge">Customize</em> : null}</button>)}</div> : <div className="empty-state"><Store size={28} /><strong>{emptyTitle}</strong><span>{emptyDetail}</span></div>}
        </div>
        <aside className={`pos-entry-cart ${mobileCartOpen ? "open" : ""}`} aria-label="Current order">
          <div className="pos-entry-cart-head"><div><h3>Current order</h3><span>{cartItemCount} item{cartItemCount === 1 ? "" : "s"}</span></div><div><button className="button-muted pos-entry-cart-close" type="button" onClick={() => setMobileCartOpen(false)}>Close</button><button className="button-muted" type="button" onClick={onClear} disabled={!cart.length}><Trash2 size={17} />Clear</button></div></div>
          <div className="pos-entry-cart-lines">
            {cart.length ? cart.map((line) => {
              const canModify = canModifyPosItem(menuItemById.get(line.menuItemId));
              return (
                <article key={line.cartLineId}>
                  <div className="pos-entry-cart-line-copy">
                    <strong>{line.name}</strong>
                    <span>{money(line.priceCents)} each</span>
                    {line.modifiers?.length ? <small>{line.modifiers.map((modifier) => modifier.name).join(", ")}</small> : null}
                    {line.specialInstructions ? <small>{line.specialInstructions}</small> : null}
                  </div>
                  <div className="pos-entry-cart-actions">
                    {canModify ? <button className="pos-entry-line-action" type="button" onClick={() => onModify(line.cartLineId)} aria-label={`Modify ${line.name}`}><SlidersHorizontal size={16} /><span>Modify</span></button> : null}
                    <button className="pos-entry-line-action" type="button" onClick={() => onRepeat(line.cartLineId)} aria-label={`Repeat ${line.name}`}><Repeat2 size={16} /><span>Repeat</span></button>
                    <div className="pos-entry-quantity">
                      <button type="button" onClick={() => onDecrease(line.cartLineId)} aria-label={`Decrease ${line.name}`}><Minus size={16} /></button>
                      <strong aria-label={`${line.name} quantity`}>{line.quantity}</strong>
                      <button type="button" onClick={() => onIncrease(line.cartLineId)} aria-label={`Increase ${line.name}`}><Plus size={16} /></button>
                    </div>
                    <button className="pos-entry-remove" type="button" onClick={() => onRemove(line.cartLineId)} aria-label={`Remove ${line.name}`} title="Remove item"><Trash2 size={17} /></button>
                  </div>
                </article>
              );
            }) : <div className="empty-state pos-entry-empty-cart"><ShoppingBag size={28} /><strong>Cart is empty</strong><span>Choose an item from the menu.</span></div>}
          </div>
          <div className="pos-entry-cart-footer"><div><span>Estimated subtotal</span><strong>{money(cartTotalCents)}</strong></div><div className="pos-entry-cart-footer-actions"><button className="button-muted" type="button" onClick={onHold} disabled={!cart.length || saving}><PauseCircle size={18} />Hold</button><button className="button-primary" type="button" onClick={onPay} disabled={!cart.length || saving}><CreditCard size={18} />Pay</button></div></div>
        </aside>
      </div>
      <button className="pos-entry-mobile-summary" type="button" onClick={() => setMobileCartOpen(true)}><span>{cartItemCount} item{cartItemCount === 1 ? "" : "s"}</span><strong>{money(cartTotalCents)}</strong><span>Review &amp; pay</span></button>
    </section>
  );
}

export function OrderReviewScreen({ cart, quote, orderType, customer, notes, onEdit, onSend, onPay, onHold, saving }) {
  const subtotal = quote?.subtotalCents ?? cart.reduce((sum, line) => sum + Number(line.priceCents || 0) * Number(line.quantity || 0), 0);
  return (
    <section className="pos-workflow-screen">
      <PosScreenHeader eyebrow={orderType.replaceAll("_", " ")} title="Review order" detail={customer?.name || "Walk-in guest"} onBack={onEdit} />
      <div className="pos-review-lines">
        {cart.map((line) => <div key={line.cartLineId || line.menuItemId}><div><strong>{line.quantity} × {line.name}</strong>{line.modifiers?.length ? <span>{line.modifiers.map((item) => item.name).join(", ")}</span> : null}{line.specialInstructions ? <span>{line.specialInstructions}</span> : null}</div><strong>{money(Number(line.priceCents || 0) * line.quantity)}</strong></div>)}
      </div>
      {notes ? <div className="pos-review-note"><strong>Order notes</strong><span>{notes}</span></div> : null}
      <dl className="pos-review-totals"><div><dt>Subtotal</dt><dd>{money(quote?.subtotalCents ?? subtotal)}</dd></div>{quote ? <><div><dt>Tax</dt><dd>{money(quote.taxCents)}</dd></div><div><dt>Delivery</dt><dd>{money(quote.deliveryFeeCents)}</dd></div></> : null}<div className="total"><dt>Total</dt><dd>{money(quote?.totalCents ?? subtotal)}</dd></div></dl>
      <div className="pos-workflow-actions split"><button className="button-muted" type="button" onClick={onHold} disabled={saving}><PauseCircle size={18} />Hold</button><button className="button-muted" type="button" onClick={onSend} disabled={saving}><ReceiptText size={18} />Send to Kitchen</button><button className="button-primary" type="button" onClick={onPay} disabled={saving}><CreditCard size={18} />Continue to payment</button></div>
    </section>
  );
}

export function PaymentSelectionScreen({ quote, canAcceptCash, canAcceptCard, cashDisabledReason, amountReceived, setAmountReceived, saving, error, onBack, onCash, onCard }) {
  const total = Number(quote?.totalCents || 0);
  const amount = Math.round(Number(amountReceived || 0) * 100);
  const change = Math.max(0, amount - total);
  return (
    <section className="pos-workflow-screen">
      <PosScreenHeader eyebrow="Checkout" title="Select payment" detail={`Amount due ${money(total)}`} onBack={onBack} />
      {error ? <div className="pos-alert" role="alert">{error}</div> : null}
      <div className="pos-payment-grid">
        <div className="pos-payment-method">
          <Banknote size={30} />
          <h3>Cash</h3>
          <label><span>Amount received</span><input type="number" min={(total / 100).toFixed(2)} step="0.01" inputMode="decimal" value={amountReceived} onChange={(event) => setAmountReceived(event.target.value)} placeholder={(total / 100).toFixed(2)} /></label>
          {amount >= total ? <p className="pos-change-due">Change due <strong>{money(change)}</strong></p> : null}
          <button className="button-primary" type="button" onClick={() => onCash(amount)} disabled={!canAcceptCash || amount < total || saving}><Banknote size={18} />Accept cash</button>
          {!canAcceptCash ? <small>{cashDisabledReason || "Cash is not available on this register."}</small> : null}
        </div>
        <div className="pos-payment-method">
          <WalletCards size={30} />
          <h3>Card or wallet</h3>
          <p>Use the restaurant's approved PCI-compliant terminal or hosted payment flow.</p>
          <button className="button-primary" type="button" onClick={onCard} disabled={!canAcceptCard || saving}><CreditCard size={18} />Send to terminal</button>
          {!canAcceptCard ? <small>Card payments are not ready for this device.</small> : null}
        </div>
      </div>
    </section>
  );
}

export function PaymentResultScreen({ success, order, changeDueCents, message, onComplete, onRetry }) {
  return (
    <section className={`pos-centered-screen ${success ? "success" : "failure"}`} role="status">
      {success ? <CheckCircle2 size={52} /> : <CreditCard size={52} />}
      <h2>{success ? "Payment complete" : "Payment needs attention"}</h2>
      <p>{message || (success ? `${order?.orderNumber || "Order"} is ready for its final receipt.` : "No payment was recorded. Choose a payment method and try again.")}</p>
      {success && changeDueCents > 0 ? <p className="pos-change-callout">Change due <strong>{money(changeDueCents)}</strong></p> : null}
      <button className="button-primary" type="button" onClick={success ? onComplete : onRetry}>{success ? "Finish order" : "Try another method"}</button>
    </section>
  );
}

export function PosOrdersScreen({ title, eyebrow, orders, emptyText, onBack, onRecall, onSelect }) {
  return (
    <section className="pos-workflow-screen">
      <PosScreenHeader eyebrow={eyebrow} title={title} onBack={onBack} />
      <div className="pos-order-list">
        {orders?.length ? orders.map((order) => <article key={order.id}><div><strong>{order.orderNumber || order.name || "Order"}</strong><span>{order.customer?.name || order.customerJson?.name || "Walk-in guest"} · {order.status || "HELD"}</span><span>{order.createdAt ? new Date(order.createdAt).toLocaleString() : ""}</span></div><strong>{order.totalCents == null ? "" : money(order.totalCents)}</strong>{onRecall ? <button className="button-muted" type="button" onClick={() => onRecall(order)}>Recall</button> : null}{onSelect ? <button className="button-muted" type="button" onClick={() => onSelect(order)}>Open</button> : null}</article>) : <div className="empty-state"><ReceiptText size={28} /><strong>{emptyText}</strong></div>}
      </div>
    </section>
  );
}

export function ShiftManagementScreen({ shift, drawer, openingCashCents, setOpeningCashCents, saving, onOpen, onClose, onBack }) {
  return (
    <section className="pos-workflow-screen">
      <PosScreenHeader eyebrow="Cash control" title="Shift workspace" detail={shift?.status === "OPEN" ? `Opened ${new Date(shift.openedAt).toLocaleString()}` : "No shift is open on this register."} onBack={onBack} />
      <div className="pos-shift-card"><Clock size={30} /><dl><div><dt>Status</dt><dd>{shift?.status || "CLOSED"}</dd></div><div><dt>Drawer</dt><dd>{drawer?.name || "No cash drawer"}</dd></div><div><dt>Current balance</dt><dd>{money(drawer?.currentBalanceCents)}</dd></div></dl></div>
      {!shift ? <label className="pos-cash-input"><span>Opening cash</span><input type="number" min="0" step="0.01" value={(openingCashCents / 100).toFixed(2)} onChange={(event) => setOpeningCashCents(Math.round(Number(event.target.value || 0) * 100))} /></label> : null}
      <div className="pos-workflow-actions">{shift ? <button className="button-danger" type="button" onClick={onClose} disabled={saving}>Close shift</button> : <button className="button-primary" type="button" onClick={onOpen} disabled={saving}>Open shift</button>}</div>
    </section>
  );
}

export function RegisterSettingsScreen({ device, deviceForm, setDeviceForm, locations, saving, ownerOperator, pinConfigured, pinValue, setPinValue, onSavePin, onRegister, onKiosk, onBack }) {
  return (
    <section className="pos-workflow-screen">
      <PosScreenHeader eyebrow="Manager workspace" title="Register settings" detail="Device, location, lock, payment, and kiosk controls stay outside order entry." onBack={device ? onBack : null} />
      {!ownerOperator ? <div className="pos-notice warn"><Settings2 size={20} /><div><strong>Manager permission required</strong><span>Ask a restaurant owner or manager to configure this register.</span></div></div> : null}
      <form className="pos-settings-grid" onSubmit={onRegister}>
        <label><span>Register name</span><input value={deviceForm.name} onChange={(event) => setDeviceForm((current) => ({ ...current, name: event.target.value }))} disabled={!ownerOperator} /></label>
        <label><span>Register type</span><select value={deviceForm.deviceType} onChange={(event) => setDeviceForm((current) => ({ ...current, deviceType: event.target.value }))} disabled={!ownerOperator}><option value="MAIN_TERMINAL">Main terminal</option><option value="POS_KIOSK">Customer kiosk</option><option value="APPROVED_MOBILE">Approved mobile</option><option value="KITCHEN_DISPLAY">Kitchen display</option><option value="MANAGER_DEVICE">Manager device</option></select></label>
        {locations?.length ? <label><span>Location</span><select value={deviceForm.locationId || ""} onChange={(event) => setDeviceForm((current) => ({ ...current, locationId: event.target.value || null }))} disabled={!ownerOperator}><option value="">Primary location</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label> : null}
        <label className="checkbox-row"><input type="checkbox" checked={deviceForm.cardPaymentsEnabled} onChange={(event) => setDeviceForm((current) => ({ ...current, cardPaymentsEnabled: event.target.checked }))} disabled={!ownerOperator} />Card terminal enabled</label>
        {ownerOperator ? <button className="button-primary" type="submit" disabled={saving}>{device ? "Update register" : "Register this device"}</button> : null}
      </form>
      {device && ownerOperator ? <div className="pos-pin-settings"><div><strong>Cashier PIN</strong><span>{pinConfigured ? "A PIN is configured for your employee account." : "Set a 4–8 digit PIN before unlocking this register."}</span></div><input type="password" inputMode="numeric" autoComplete="new-password" value={pinValue} onChange={(event) => setPinValue(event.target.value.replace(/\D/g, "").slice(0, 8))} aria-label="New cashier PIN" placeholder="4–8 digits" /><button className="button-muted" type="button" onClick={onSavePin} disabled={saving || pinValue.length < 4}>Save PIN</button></div> : null}
      {device && ownerOperator ? <button className="button-muted" type="button" onClick={onKiosk}><MonitorCog size={18} />{device.kioskModeEnabled ? "Review kiosk lock" : "Configure kiosk mode"}</button> : null}
    </section>
  );
}

export function OrderCompleteScreen({ order, onHome, onNewOrder, onPrint, printLabel = "Print Guest Check" }) {
  return (
    <section className="pos-centered-screen success">
      <CheckCircle2 size={52} />
      <h2>Order complete</h2>
      <p>{order?.orderNumber || "The order"} has been committed through the canonical order workflow.</p>
      <div className="pos-workflow-actions">{onPrint ? <button className="button-muted" type="button" onClick={onPrint}><ReceiptText size={18} />{printLabel}</button> : null}<button className="button-primary" type="button" onClick={onNewOrder}>New order</button><button className="button-muted" type="button" onClick={onHome}>Register home</button></div>
    </section>
  );
}

export function RecoveryScreen({ message, onRetry, onLock }) {
  return (
    <section className="pos-centered-screen failure" role="alert">
      <RefreshCw size={42} />
      <h2>Register recovery</h2>
      <p>{message || "The last action could not be confirmed. Retry safely before creating another payment or order."}</p>
      <div className="pos-workflow-actions"><button className="button-primary" type="button" onClick={onRetry}>Retry</button><button className="button-muted" type="button" onClick={onLock}>Lock register</button></div>
    </section>
  );
}

export function CashierBadge({ user }) {
  return <span className="pos-cashier-badge"><UserRound size={16} />{user?.name || user?.email || "Cashier"}</span>;
}
