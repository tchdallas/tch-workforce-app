"use client"

import * as React from "react"
import { useState } from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { Drawer, DrawerContent } from "@/components/ui/drawer"

const Select = SelectPrimitive.Root
const SelectGroup = SelectPrimitive.Group
const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className
    )}
    {...props}>
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}>
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}>
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName

// Mobile bottom-sheet wrapper that intercepts SelectContent on mobile
const SelectContent = React.forwardRef(({ className, children, position = "popper", ...props }, ref) => {
  const isMobile = useIsMobile()

  if (isMobile) {
    // On mobile we need to read the open state from the Radix Select context.
    // We do this by hijacking the onPointerDownOutside/onInteractOutside to close
    // and reading state via the Radix primitive's data attribute on the trigger.
    // The cleanest approach: wrap in a Drawer that mirrors the Select's open state.
    return (
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          ref={ref}
          // Render off-screen; the Drawer below is the real UI
          className="sr-only"
          position="item-aligned"
          {...props}
        >
          <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    )
  }

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        className={cn(
          "relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        {...props}>
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn("p-1", position === "popper" &&
            "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]")}>
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
})
SelectContent.displayName = SelectPrimitive.Content.displayName

// MobileSelect: a full replacement for Select on mobile that uses a Drawer bottom sheet
function MobileSelectRoot({ value, onValueChange, children, defaultValue, open, onOpenChange, ...props }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const isMobile = useIsMobile()

  if (!isMobile) {
    return (
      <SelectPrimitive.Root value={value} onValueChange={onValueChange} defaultValue={defaultValue} open={open} onOpenChange={onOpenChange} {...props}>
        {children}
      </SelectPrimitive.Root>
    )
  }

  // Extract items from children tree for the bottom sheet
  const items = []
  const triggerEl = React.Children.toArray(children).find(c => c?.type?.displayName === SelectTrigger.displayName || c?.type === SelectTrigger)
  
  // Collect all SelectItem values/labels recursively
  const collectItems = (nodes) => {
    React.Children.forEach(nodes, (child) => {
      if (!child) return
      if (child?.type?.displayName === SelectItem.displayName || child?.type === SelectItem) {
        items.push({ value: child.props.value, label: child.props.children, disabled: child.props.disabled })
      } else if (child?.props?.children) {
        collectItems(child.props.children)
      }
    })
  }
  collectItems(children)

  const displayLabel = items.find(i => i.value === value)?.label

  return (
    <>
      {/* Render a fake trigger that opens the Drawer */}
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        className="flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        {...props}
      >
        <span className={cn("line-clamp-1", !displayLabel && "text-muted-foreground")}>
          {/* Find the placeholder from the SelectValue child */}
          {displayLabel || (() => {
            const sv = React.Children.toArray(
              React.Children.toArray(children).find(c => c?.type === SelectTrigger || c?.type?.displayName === SelectTrigger.displayName)?.props?.children
            ).find(c => c?.type === SelectValue || c?.type?.displayName === SelectValue.displayName)
            return sv?.props?.placeholder || 'Select...'
          })()}
        </span>
        <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
      </button>

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent>
          <div className="px-4 pt-2 pb-6">
            <div className="flex items-center justify-between mb-4">
              <span className="font-semibold text-sm text-foreground">Select an option</span>
            </div>
            <div className="space-y-1 max-h-[60vh] overflow-y-auto">
              {items.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  disabled={item.disabled}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-3 rounded-lg text-sm transition-colors",
                    item.value === value
                      ? "bg-primary/10 text-primary font-medium"
                      : "hover:bg-muted/60 text-foreground",
                    item.disabled && "opacity-40 pointer-events-none"
                  )}
                  onClick={() => {
                    onValueChange?.(item.value)
                    setDrawerOpen(false)
                  }}
                >
                  <span>{item.label}</span>
                  {item.value === value && <Check className="w-4 h-4 shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}

const SelectLabel = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-sm font-semibold", className)}
    {...props} />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}>
    <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props} />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  MobileSelectRoot as Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}