import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/jalali.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';
import 'vip_discount.dart';

class VipQuotaCard extends StatelessWidget {
  const VipQuotaCard({super.key, required this.remaining});

  final int remaining;

  @override
  Widget build(BuildContext context) {
    return AppSurface(
      tone: AppSurfaceTone.hero,
      padding: const EdgeInsets.symmetric(
        horizontal: AppTokens.space16,
        vertical: AppTokens.space12,
      ),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(
                color: AppTokens.accent.withValues(alpha: 0.55),
              ),
              color: AppTokens.accentMuted,
            ),
            child: const Icon(
              Icons.workspace_premium_outlined,
              color: AppTokens.accent,
              size: 18,
            ),
          ),
          const SizedBox(width: AppTokens.space12),
          Expanded(
            child: Text(
              AppStrings.vipRemainingQuota(remaining),
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                color: AppTokens.textPrimary,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class VipRequestSizeChip extends StatelessWidget {
  const VipRequestSizeChip({
    super.key,
    required this.value,
    required this.selected,
    required this.enabled,
    this.onSelected,
  });

  final int value;
  final bool selected;
  final bool enabled;
  final VoidCallback? onSelected;

  @override
  Widget build(BuildContext context) {
    final label = toPersianDigits(value.toString());
    final borderColor = selected
        ? AppTokens.accent
        : AppTokens.line.withValues(alpha: enabled ? 1 : 0.45);
    final background = selected
        ? AppTokens.accentDeep.withValues(alpha: 0.92)
        : AppTokens.surface.withValues(alpha: 0.55);
    final foreground = selected
        ? AppTokens.onAccent
        : enabled
        ? AppTokens.textPrimary
        : AppTokens.textSecondary.withValues(alpha: 0.55);
    return Opacity(
      opacity: enabled ? 1 : 0.55,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: enabled ? onSelected : null,
          borderRadius: BorderRadius.circular(AppTokens.radiusMd),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 160),
            padding: const EdgeInsets.symmetric(
              horizontal: AppTokens.space12,
              vertical: AppTokens.space12,
            ),
            decoration: BoxDecoration(
              color: background,
              borderRadius: BorderRadius.circular(AppTokens.radiusMd),
              border: Border.all(color: borderColor, width: selected ? 1.4 : 1),
            ),
            child: FittedBox(
              fit: BoxFit.scaleDown,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (selected) ...[
                    Icon(Icons.check, size: 16, color: foreground),
                    const SizedBox(width: 4),
                  ],
                  Text(
                    label,
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      color: foreground,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class VipRequestSizeSelector extends StatelessWidget {
  const VipRequestSizeSelector({
    super.key,
    required this.sizes,
    required this.selected,
    required this.remainingQuota,
    required this.enabled,
    required this.onSelected,
  });

  final List<int> sizes;
  final int? selected;
  final int remainingQuota;
  final bool enabled;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (var index = 0; index < sizes.length; index++) ...[
          if (index > 0) const SizedBox(width: AppTokens.space8),
          Expanded(
            child: Builder(
              builder: (context) {
                final value = sizes[index];
                final sizeEnabled = enabled && remainingQuota > 0;
                return VipRequestSizeChip(
                  key: Key('vip-request-size-$value'),
                  value: value,
                  selected: selected == value,
                  enabled: sizeEnabled,
                  onSelected: sizeEnabled ? () => onSelected(value) : null,
                );
              },
            ),
          ),
        ],
      ],
    );
  }
}

class VipGlassField extends StatelessWidget {
  const VipGlassField({
    super.key,
    required this.child,
    this.onTap,
    this.highlighted = false,
  });

  final Widget child;
  final VoidCallback? onTap;
  final bool highlighted;

  @override
  Widget build(BuildContext context) {
    return AppSurface(
      tone: highlighted ? AppSurfaceTone.hero : AppSurfaceTone.elevated,
      onTap: onTap,
      padding: const EdgeInsets.symmetric(
        horizontal: AppTokens.space16,
        vertical: AppTokens.space12,
      ),
      radius: AppTokens.radiusLg,
      child: child,
    );
  }
}

class VipRegionPickerTile extends StatelessWidget {
  const VipRegionPickerTile({
    super.key = const Key('vip-region-picker'),
    required this.label,
    required this.enabled,
    required this.onTap,
  });

  final String label;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return VipGlassField(
      onTap: enabled ? onTap : null,
      child: Row(
        children: [
          Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(
                color: AppTokens.accent.withValues(alpha: 0.45),
              ),
            ),
            child: const Icon(
              Icons.location_on_outlined,
              color: AppTokens.accent,
              size: 18,
            ),
          ),
          const SizedBox(width: AppTokens.space12),
          Expanded(
            child: Text(
              label,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: AppTokens.textSecondary,
              ),
            ),
          ),
          Icon(
            Icons.expand_more,
            color: enabled ? AppTokens.textSecondary : AppTokens.line,
          ),
        ],
      ),
    );
  }
}

class VipSectionCard extends StatelessWidget {
  const VipSectionCard({
    super.key,
    required this.title,
    required this.icon,
    required this.child,
  });

  final String title;
  final IconData icon;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return AppSurface(
      tone: AppSurfaceTone.hero,
      radius: AppTokens.radiusLg,
      padding: const EdgeInsets.all(AppTokens.space16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: AppTokens.accent.withValues(alpha: 0.45),
                  ),
                ),
                child: Icon(icon, color: AppTokens.accent, size: 16),
              ),
              const SizedBox(width: AppTokens.space12),
              Expanded(
                child: Text(
                  title,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppTokens.space16),
          child,
        ],
      ),
    );
  }
}

class VipDiscountKindChip extends StatelessWidget {
  const VipDiscountKindChip({
    super.key,
    required this.label,
    required this.selected,
    required this.enabled,
    this.onSelected,
  });

  final String label;
  final bool selected;
  final bool enabled;
  final VoidCallback? onSelected;

  @override
  Widget build(BuildContext context) {
    final borderColor = selected ? AppTokens.accent : AppTokens.line;
    final background = selected
        ? AppTokens.accentDeep.withValues(alpha: 0.92)
        : AppTokens.surface.withValues(alpha: 0.45);
    final foreground = selected
        ? AppTokens.onAccent
        : AppTokens.textSecondary;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: enabled ? onSelected : null,
        borderRadius: BorderRadius.circular(AppTokens.radiusMd),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          padding: const EdgeInsets.symmetric(
            horizontal: AppTokens.space8,
            vertical: AppTokens.space12,
          ),
          decoration: BoxDecoration(
            color: background,
            borderRadius: BorderRadius.circular(AppTokens.radiusMd),
            border: Border.all(color: borderColor, width: selected ? 1.4 : 1),
          ),
          child: FittedBox(
            fit: BoxFit.scaleDown,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (selected) ...[
                  Icon(Icons.check, size: 14, color: foreground),
                  const SizedBox(width: 4),
                ],
                Text(
                  label,
                  style: Theme.of(context).textTheme.labelLarge?.copyWith(
                    color: foreground,
                    fontSize: 13,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class VipDiscountSection extends StatelessWidget {
  const VipDiscountSection({
    super.key,
    required this.kind,
    required this.amountController,
    required this.parse,
    required this.enabled,
    required this.onKindSelected,
    required this.onAmountChanged,
    required this.onClear,
  });

  final VipDiscountKind kind;
  final TextEditingController amountController;
  final VipDiscountParse parse;
  final bool enabled;
  final ValueChanged<VipDiscountKind> onKindSelected;
  final ValueChanged<String> onAmountChanged;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final showAmount = kind != VipDiscountKind.none;
    return VipSectionCard(
      title: AppStrings.vipIntendedDiscount,
      icon: Icons.sell_outlined,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: VipDiscountKindChip(
                  key: const Key('vip-discount-none'),
                  label: AppStrings.vipNoDiscount,
                  selected: kind == VipDiscountKind.none,
                  enabled: enabled,
                  onSelected: () => onKindSelected(VipDiscountKind.none),
                ),
              ),
              const SizedBox(width: AppTokens.space8),
              Expanded(
                child: VipDiscountKindChip(
                  key: const Key('vip-discount-percent'),
                  label: AppStrings.vipPercentDiscount,
                  selected: kind == VipDiscountKind.percent,
                  enabled: enabled,
                  onSelected: () => onKindSelected(VipDiscountKind.percent),
                ),
              ),
              const SizedBox(width: AppTokens.space8),
              Expanded(
                child: VipDiscountKindChip(
                  key: const Key('vip-discount-rial'),
                  label: AppStrings.vipRialDiscount,
                  selected: kind == VipDiscountKind.irr,
                  enabled: enabled,
                  onSelected: () => onKindSelected(VipDiscountKind.irr),
                ),
              ),
            ],
          ),
          if (showAmount) ...[
            const SizedBox(height: AppTokens.space12),
            TextField(
              key: const Key('vip-discount-amount'),
              controller: amountController,
              enabled: enabled,
              keyboardType: TextInputType.number,
              textInputAction: TextInputAction.done,
              onChanged: onAmountChanged,
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[0-9۰-۹٠-٩]')),
              ],
              decoration: InputDecoration(
                hintText: AppStrings.vipDiscountAmountHint,
                errorText: amountController.text.isEmpty ? null : parse.error,
                suffixText: kind == VipDiscountKind.percent ? '٪' : 'ریال',
                suffixStyle: Theme.of(context).textTheme.titleSmall?.copyWith(
                  color: AppTokens.textSecondary,
                ),
              ),
            ),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: enabled ? onClear : null,
                child: const Text(AppStrings.vipDiscountClear),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class VipSummaryRow extends StatelessWidget {
  const VipSummaryRow({
    super.key,
    required this.icon,
    required this.label,
    required this.value,
    this.placeholder = false,
    this.valueMaxLines,
    this.valueFontSize,
  });

  final IconData icon;
  final String label;
  final String value;
  final bool placeholder;
  final int? valueMaxLines;
  final double? valueFontSize;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTokens.space12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: AppTokens.textSecondary),
          const SizedBox(width: AppTokens.space8),
          Expanded(
            child: Text(
              label,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
          const SizedBox(width: AppTokens.space8),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.left,
              maxLines: valueMaxLines,
              overflow: valueMaxLines == null ? null : TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: placeholder ? AppTokens.textSecondary : AppTokens.accent,
                fontWeight: placeholder ? FontWeight.w400 : FontWeight.w600,
                fontSize: valueFontSize,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class VipOrderSummary extends StatelessWidget {
  const VipOrderSummary({
    super.key,
    required this.count,
    required this.plannedCount,
    required this.region,
    required this.selectedList,
    required this.discountKind,
    required this.discountParse,
  });

  final int? count;
  final int? plannedCount;
  final VipRegion? region;
  final VipTargetList? selectedList;
  final VipDiscountKind discountKind;
  final VipDiscountParse discountParse;

  @override
  Widget build(BuildContext context) {
    final discountValue = switch (discountKind) {
      VipDiscountKind.none => AppStrings.vipNoDiscount,
      VipDiscountKind.percent =>
        discountParse.valid && discountParse.asciiAmount != null
            ? AppStrings.vipSummaryPercentValue(discountParse.asciiAmount!)
            : AppStrings.vipSummaryUnset,
      VipDiscountKind.irr =>
        discountParse.valid && discountParse.asciiAmount != null
            ? AppStrings.vipSummaryRialValue(discountParse.asciiAmount!)
            : AppStrings.vipSummaryUnset,
    };
    return VipSectionCard(
      title: AppStrings.vipOrderSummary,
      icon: Icons.description_outlined,
      child: Column(
        children: [
          VipSummaryRow(
            icon: Icons.groups_outlined,
            label: AppStrings.vipSummaryPackage,
            value: count == null
                ? AppStrings.vipSummaryUnset
                : AppStrings.vipSummaryRecipientCount(count!),
            placeholder: count == null,
          ),
          VipSummaryRow(
            icon: Icons.person_outline,
            label: AppStrings.vipSummaryActualRecipients,
            value: plannedCount == null
                ? AppStrings.vipSummaryUnset
                : AppStrings.vipSummaryRecipientCount(plannedCount!),
            placeholder: plannedCount == null,
          ),
          VipSummaryRow(
            icon: Icons.pie_chart_outline,
            label: AppStrings.vipSummaryQuotaUse,
            value: plannedCount == null
                ? AppStrings.vipSummaryUnset
                : AppStrings.vipSummaryRecipientCount(plannedCount!),
            placeholder: plannedCount == null,
          ),
          VipSummaryRow(
            icon: Icons.location_on_outlined,
            label: AppStrings.vipSummaryRegion,
            value: region == null
                ? AppStrings.vipSummaryUnset
                : region!.regionName,
            placeholder: region == null,
            valueMaxLines: 1,
            valueFontSize: 12,
          ),
          VipSummaryRow(
            icon: Icons.list_alt_outlined,
            label: AppStrings.vipSummaryList,
            value: selectedList == null
                ? AppStrings.vipSummaryUnset
                : selectedList!.name,
            placeholder: selectedList == null,
          ),
          VipSummaryRow(
            icon: Icons.sell_outlined,
            label: AppStrings.vipSummaryDiscount,
            value: discountValue,
            placeholder: discountKind != VipDiscountKind.none &&
                !(discountParse.valid && discountParse.isNonzero),
          ),
        ],
      ),
    );
  }
}

class VipPrimaryAction extends StatelessWidget {
  const VipPrimaryAction({
    super.key,
    required this.enabled,
    required this.busy,
    required this.onPressed,
  });

  final bool enabled;
  final bool busy;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      onPressed: enabled && !busy ? onPressed : null,
      child: busy
          ? const SizedBox(
              height: 18,
              width: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Text(AppStrings.sendMessageAction),
    );
  }
}
