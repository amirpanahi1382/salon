import 'package:flutter/material.dart';
import 'package:shamsi_date/shamsi_date.dart';

import 'jalali.dart';
import 'labels.dart';

Future<Jalali?> showJalaliDatePicker({
  required BuildContext context,
  required DateTime initialDate,
  required DateTime firstDate,
  required DateTime lastDate,
}) {
  return showDialog<Jalali>(
    context: context,
    builder: (context) => JalaliDatePickerDialog(
      initialDate: jalaliFromLocal(initialDate),
      firstDate: jalaliFromLocal(firstDate),
      lastDate: jalaliFromLocal(lastDate),
    ),
  );
}

class JalaliDatePickerDialog extends StatefulWidget {
  const JalaliDatePickerDialog({
    super.key,
    required this.initialDate,
    required this.firstDate,
    required this.lastDate,
  });

  final Jalali initialDate;
  final Jalali firstDate;
  final Jalali lastDate;

  @override
  State<JalaliDatePickerDialog> createState() => _JalaliDatePickerDialogState();
}

class _JalaliDatePickerDialogState extends State<JalaliDatePickerDialog> {
  late Jalali _visibleMonth;
  late Jalali _selected;

  @override
  void initState() {
    super.initState();
    _selected = widget.initialDate;
    _visibleMonth = Jalali(_selected.year, _selected.month, 1);
  }

  bool _isBefore(Jalali a, Jalali b) {
    return a.toDateTime().isBefore(
      DateTime(b.toGregorian().year, b.toGregorian().month, b.toGregorian().day),
    );
  }

  bool _isAfterDay(Jalali a, Jalali b) {
    final ga = a.toGregorian();
    final gb = b.toGregorian();
    return DateTime(ga.year, ga.month, ga.day).isAfter(
      DateTime(gb.year, gb.month, gb.day),
    );
  }

  bool _sameDay(Jalali a, Jalali b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;

  bool _canSelect(Jalali day) {
    if (_isBefore(day, widget.firstDate)) {
      return false;
    }
    if (_isAfterDay(day, widget.lastDate)) {
      return false;
    }
    return true;
  }

  void _shiftMonth(int delta) {
    var year = _visibleMonth.year;
    var month = _visibleMonth.month + delta;
    if (month < 1) {
      month = 12;
      year -= 1;
    } else if (month > 12) {
      month = 1;
      year += 1;
    }
    setState(() => _visibleMonth = Jalali(year, month, 1));
  }

  List<Jalali?> _monthCells() {
    final first = Jalali(_visibleMonth.year, _visibleMonth.month, 1);
    final leading = first.weekDay - 1;
    final daysInMonth = first.monthLength;
    return [
      ...List<Jalali?>.filled(leading, null),
      ...List<Jalali>.generate(
        daysInMonth,
        (index) => Jalali(first.year, first.month, index + 1),
      ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cells = _monthCells();
    return Directionality(
      textDirection: TextDirection.rtl,
      child: AlertDialog(
        titlePadding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
        contentPadding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
        title: Row(
          children: [
            IconButton(
              tooltip: AppStrings.nextMonth,
              onPressed: () => _shiftMonth(1),
              icon: const Icon(Icons.chevron_right),
            ),
            Expanded(
              child: Text(
                jalaliMonthTitle(_visibleMonth),
                textAlign: TextAlign.center,
                style: theme.textTheme.titleMedium,
              ),
            ),
            IconButton(
              tooltip: AppStrings.previousMonth,
              onPressed: () => _shiftMonth(-1),
              icon: const Icon(Icons.chevron_left),
            ),
          ],
        ),
        content: SizedBox(
          width: 320,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: jalaliWeekdayShort
                    .map(
                      (label) => Expanded(
                        child: Text(
                          label,
                          textAlign: TextAlign.center,
                          style: theme.textTheme.labelMedium?.copyWith(
                            color: theme.colorScheme.primary,
                          ),
                        ),
                      ),
                    )
                    .toList(),
              ),
              const SizedBox(height: 8),
              GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: cells.length,
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 7,
                  mainAxisSpacing: 4,
                  crossAxisSpacing: 4,
                ),
                itemBuilder: (context, index) {
                  final day = cells[index];
                  if (day == null) {
                    return const SizedBox.shrink();
                  }
                  final enabled = _canSelect(day);
                  final selected = _sameDay(day, _selected);
                  return InkWell(
                    onTap: enabled
                        ? () => setState(() => _selected = day)
                        : null,
                    borderRadius: BorderRadius.circular(20),
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: selected
                            ? theme.colorScheme.primary
                            : Colors.transparent,
                        shape: BoxShape.circle,
                      ),
                      child: Center(
                        child: Text(
                          toPersianDigits(day.day.toString()),
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: !enabled
                                ? theme.disabledColor
                                : selected
                                ? theme.colorScheme.onPrimary
                                : theme.colorScheme.onSurface,
                          ),
                        ),
                      ),
                    ),
                  );
                },
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text(AppStrings.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, _selected),
            child: const Text(AppStrings.confirm),
          ),
        ],
      ),
    );
  }
}
