"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { createProduct, updateProduct } from "@/app/actions/products";
import { publishPriceVersion } from "@/app/actions/prices";
import { formatIstDisplay, utcToIstDatetimeLocal } from "@/lib/time/ist";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { FormError } from "@/components/ui/form-error";
import { PriceQuickEdit } from "@/components/price-quick-edit";
import { useToast } from "@/components/ui/toast";

export interface CatalogProduct {
  id: string;
  name: string;
  unitType: "weight" | "count";
  unitLabel: string | null;
  active: boolean;
  currentPrice: number | null;
  history: { pricePerUnit: number; effectiveFrom: string }[];
  tiers: { minQty: number; pricePerUnit: number }[];
}

interface TierRow {
  minQty: number;
  pricePerUnit: number;
}

interface FormState {
  name: string;
  unitType: "weight" | "count";
  unitLabel: string;
}

const EMPTY_FORM: FormState = { name: "", unitType: "weight", unitLabel: "" };

export function CatalogManager({ products }: { products: CatalogProduct[] }) {
  const router = useRouter();
  const { showToast } = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<FormState>(EMPTY_FORM);
  const [addPending, setAddPending] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  const [editActive, setEditActive] = useState(true);
  const [editPending, setEditPending] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [editTiers, setEditTiers] = useState<TierRow[]>([]);
  const [newTierMinQty, setNewTierMinQty] = useState("");
  const [newTierPrice, setNewTierPrice] = useState("");
  const [tierRowError, setTierRowError] = useState<string | null>(null);
  const [tiersPending, setTiersPending] = useState(false);
  const [tiersError, setTiersError] = useState<string | null>(null);

  const editingProduct = products.find((p) => p.id === editingId) ?? null;

  function openEdit(product: CatalogProduct) {
    setEditingId(product.id);
    setEditForm({ name: product.name, unitType: product.unitType, unitLabel: product.unitLabel ?? "" });
    setEditActive(product.active);
    setEditError(null);
    setEditTiers(product.tiers);
    setNewTierMinQty("");
    setNewTierPrice("");
    setTierRowError(null);
    setTiersError(null);
  }

  function handleAddTierRow() {
    const minQty = Number(newTierMinQty);
    const pricePerUnit = Number(newTierPrice);
    if (!Number.isFinite(minQty) || minQty <= 0 || !Number.isFinite(pricePerUnit) || pricePerUnit <= 0) {
      setTierRowError("Enter a quantity and a price greater than zero.");
      return;
    }
    if (editTiers.some((tier) => tier.minQty === minQty)) {
      setTierRowError("A tier at that quantity already exists.");
      return;
    }
    setTierRowError(null);
    setEditTiers((prev) => [...prev, { minQty, pricePerUnit }].sort((a, b) => a.minQty - b.minQty));
    setNewTierMinQty("");
    setNewTierPrice("");
  }

  function handleRemoveTierRow(index: number) {
    setEditTiers((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSaveTiers() {
    if (!editingProduct || editingProduct.currentPrice === null) return;
    setTiersError(null);
    setTiersPending(true);
    const result = await publishPriceVersion({
      effectiveFromIst: utcToIstDatetimeLocal(new Date()),
      note: null,
      items: [
        {
          productId: editingProduct.id,
          pricePerUnit: editingProduct.currentPrice,
          tiers: editTiers,
          replaceTiers: true,
        },
      ],
      newAliases: [],
    });
    setTiersPending(false);
    if (!result.ok) {
      setTiersError(result.error);
      return;
    }
    showToast("Quantity pricing saved ✓");
    router.refresh();
  }

  async function handleAdd() {
    setAddError(null);
    setAddPending(true);
    const result = await createProduct({
      name: addForm.name,
      unitType: addForm.unitType,
      unitLabel: addForm.unitLabel,
    });
    setAddPending(false);
    if (!result.ok) {
      setAddError(result.error);
      return;
    }
    setAddOpen(false);
    setAddForm(EMPTY_FORM);
    showToast(`${result.product.name} added ✓`);
    router.refresh();
  }

  async function handleEditSave() {
    if (!editingProduct) return;
    setEditError(null);
    setEditPending(true);
    const result = await updateProduct({
      id: editingProduct.id,
      name: editForm.name,
      unitType: editForm.unitType,
      unitLabel: editForm.unitLabel,
      active: editActive,
    });
    setEditPending(false);
    if (!result.ok) {
      setEditError(result.error);
      return;
    }
    showToast("Product updated ✓");
    router.refresh();
    setEditingId(null);
  }

  const active = products.filter((p) => p.active);
  const inactive = products.filter((p) => !p.active);

  return (
    <div className="flex flex-col gap-4">
      <Button
        variant="dark"
        fullWidth
        onClick={() => {
          setAddForm(EMPTY_FORM);
          setAddError(null);
          setAddOpen(true);
        }}
      >
        <Plus className="size-4" aria-hidden="true" /> Add product
      </Button>

      <div className="flex flex-col gap-2">
        {active.map((product) => (
          <ProductCard key={product.id} product={product} onOpen={() => openEdit(product)} />
        ))}
      </div>

      {inactive.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="font-sans text-[11.5px] font-bold uppercase tracking-wide text-muted">Inactive</div>
          {inactive.map((product) => (
            <ProductCard key={product.id} product={product} onOpen={() => openEdit(product)} dimmed />
          ))}
        </div>
      )}

      {products.length === 0 && (
        <p className="font-sans text-sm text-muted">No products yet — add your first fruit above.</p>
      )}

      <BottomSheet open={addOpen} onClose={() => setAddOpen(false)}>
        <div className="flex flex-col gap-3">
          <div className="font-display text-base font-bold text-foreground">Add product</div>
          <ProductForm form={addForm} onChange={setAddForm} />
          {addError && <FormError>{addError}</FormError>}
          <Button variant="primary" fullWidth pending={addPending} pendingText="Adding…" onClick={handleAdd}>
            Add product
          </Button>
        </div>
      </BottomSheet>

      <BottomSheet open={editingProduct !== null} onClose={() => setEditingId(null)}>
        {editingProduct && (
          <div className="flex max-h-[80vh] flex-col gap-3 overflow-y-auto">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 truncate font-display text-base font-bold text-foreground">
                {editingProduct.name}
              </div>
              <PriceQuickEdit productId={editingProduct.id} currentPrice={editingProduct.currentPrice} />
            </div>

            <ProductForm form={editForm} onChange={setEditForm} />

            <button
              type="button"
              onClick={() => setEditActive((a) => !a)}
              className="flex items-center justify-between rounded-2xl bg-neutral-bg px-3.5 py-3"
            >
              <span className="font-sans text-sm font-bold text-foreground">Active</span>
              <Badge tone={editActive ? "success" : "neutral"} size="sm">
                {editActive ? "Active" : "Inactive — tap to reactivate"}
              </Badge>
            </button>

            {editError && <FormError>{editError}</FormError>}

            <Button variant="primary" fullWidth pending={editPending} pendingText="Saving…" onClick={handleEditSave}>
              Save changes
            </Button>

            <div className="flex flex-col gap-2 border-t border-[#ECEAE3] pt-3">
              <div className="font-sans text-[11.5px] font-bold uppercase tracking-wide text-muted">
                Quantity pricing
              </div>
              {editingProduct.currentPrice === null ? (
                <p className="font-sans text-sm text-muted">Set a base price above before adding quantity tiers.</p>
              ) : (
                <>
                  {editTiers.length === 0 && (
                    <p className="font-sans text-sm text-muted">
                      No tiers — always bills at the base rate, ₹{editingProduct.currentPrice.toFixed(2)}.
                    </p>
                  )}
                  {editTiers.map((tier, index) => (
                    <div key={index} className="flex items-center justify-between gap-2 rounded-xl bg-neutral-bg px-3 py-2">
                      <span className="font-sans text-sm font-semibold text-foreground">
                        {tier.minQty}
                        {editingProduct.unitLabel ?? editingProduct.unitType}+ → ₹{tier.pricePerUnit.toFixed(2)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTierRow(index)}
                        className="rounded-full p-1 text-muted hover:bg-white"
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-end gap-1.5">
                    <label className="flex flex-1 flex-col gap-1">
                      <span className="font-sans text-xs text-muted">Qty at or above</span>
                      <Input
                        type="number"
                        step="0.001"
                        min="0"
                        value={newTierMinQty}
                        onChange={(e) => setNewTierMinQty(e.target.value)}
                        placeholder={`e.g. 5 ${editingProduct.unitLabel ?? editingProduct.unitType}`}
                      />
                    </label>
                    <label className="flex flex-1 flex-col gap-1">
                      <span className="font-sans text-xs text-muted">Rate</span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={newTierPrice}
                        onChange={(e) => setNewTierPrice(e.target.value)}
                        placeholder="₹ per unit"
                      />
                    </label>
                    <Button size="md" variant="outline" onClick={handleAddTierRow}>
                      Add
                    </Button>
                  </div>
                  {tierRowError && <FormError>{tierRowError}</FormError>}
                  {tiersError && <FormError>{tiersError}</FormError>}
                  <Button
                    variant="secondary"
                    fullWidth
                    pending={tiersPending}
                    pendingText="Saving…"
                    onClick={handleSaveTiers}
                  >
                    Save quantity pricing
                  </Button>
                </>
              )}
            </div>

            <div className="flex flex-col gap-1.5 border-t border-[#ECEAE3] pt-3">
              <div className="font-sans text-[11.5px] font-bold uppercase tracking-wide text-muted">
                Price history
              </div>
              {editingProduct.history.length === 0 && (
                <p className="font-sans text-sm text-muted">No prices published yet.</p>
              )}
              {editingProduct.history.map((entry, i) => (
                <div key={i} className="flex items-center justify-between font-sans text-sm">
                  <span className="text-muted">{formatIstDisplay(new Date(entry.effectiveFrom))}</span>
                  <span className="font-bold text-foreground">₹{entry.pricePerUnit.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

function ProductCard({
  product,
  onOpen,
  dimmed,
}: {
  product: CatalogProduct;
  onOpen: () => void;
  dimmed?: boolean;
}) {
  return (
    <Card
      elevated
      onClick={onOpen}
      className={cn("flex items-center justify-between gap-3 !space-y-0", dimmed && "opacity-55")}
    >
      <div className="min-w-0 flex-1">
        <div className="font-sans text-sm font-bold text-foreground">{product.name}</div>
        <div className="font-sans text-[11.5px] font-semibold text-muted">
          per {product.unitLabel ?? product.unitType}
        </div>
      </div>
      <div className="font-display text-[15px] font-bold text-foreground">
        {product.currentPrice !== null ? (
          `₹${product.currentPrice.toFixed(2)}`
        ) : (
          <span className="text-danger-text">Not priced</span>
        )}
      </div>
    </Card>
  );
}

function ProductForm({ form, onChange }: { form: FormState; onChange: (f: FormState) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="font-sans text-sm text-muted">Name</span>
        <Input
          type="text"
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          placeholder="Alphonso Mango"
        />
      </label>
      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className="font-sans text-sm text-muted">Priced by</span>
          <Select
            value={form.unitType}
            onChange={(e) => onChange({ ...form, unitType: e.target.value as "weight" | "count" })}
          >
            <option value="weight">Weight</option>
            <option value="count">Count</option>
          </Select>
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="font-sans text-sm text-muted">Unit label</span>
          <Input
            type="text"
            value={form.unitLabel}
            onChange={(e) => onChange({ ...form, unitLabel: e.target.value })}
            placeholder="kg, dozen, piece…"
          />
        </label>
      </div>
    </div>
  );
}
