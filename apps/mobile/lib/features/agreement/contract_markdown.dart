import 'package:flutter/material.dart';

/// Display-only rendering for contract markdown.
/// Keeps the visible wording faithful to the source text while hiding `#` and `**`
/// markers. Does not change the accepted canonical document or hashes.
class ContractMarkdownView extends StatelessWidget {
  const ContractMarkdownView({
    super.key,
    required this.source,
  });

  final String source;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context).textTheme;
    final blocks = _parseBlocks(source);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var index = 0; index < blocks.length; index += 1) ...[
          if (index > 0) SizedBox(height: blocks[index].spacingBefore),
          Text.rich(
            TextSpan(children: blocks[index].spans),
            key: Key('contract-md-block-$index'),
            style: switch (blocks[index].kind) {
              _BlockKind.h1 => theme.headlineSmall,
              _BlockKind.h2 => theme.titleLarge,
              _BlockKind.h3 => theme.titleMedium,
              _BlockKind.body => theme.bodyMedium,
            },
          ),
        ],
      ],
    );
  }
}

enum _BlockKind { h1, h2, h3, body }

class _Block {
  const _Block({
    required this.kind,
    required this.spans,
    required this.spacingBefore,
  });

  final _BlockKind kind;
  final List<InlineSpan> spans;
  final double spacingBefore;
}

List<_Block> _parseBlocks(String source) {
  final lines = source.replaceAll('\r\n', '\n').split('\n');
  final blocks = <_Block>[];
  final body = StringBuffer();

  void flushBody() {
    final text = body.toString();
    body.clear();
    if (text.isEmpty) {
      return;
    }
    blocks.add(
      _Block(
        kind: _BlockKind.body,
        spans: _inlineSpans(text),
        spacingBefore: blocks.isEmpty ? 0 : 10,
      ),
    );
  }

  for (final raw in lines) {
    final line = raw.trimRight();
    if (line.startsWith('### ')) {
      flushBody();
      blocks.add(
        _Block(
          kind: _BlockKind.h3,
          spans: _inlineSpans(line.substring(4)),
          spacingBefore: blocks.isEmpty ? 0 : 16,
        ),
      );
      continue;
    }
    if (line.startsWith('## ')) {
      flushBody();
      blocks.add(
        _Block(
          kind: _BlockKind.h2,
          spans: _inlineSpans(line.substring(3)),
          spacingBefore: blocks.isEmpty ? 0 : 18,
        ),
      );
      continue;
    }
    if (line.startsWith('# ')) {
      flushBody();
      blocks.add(
        _Block(
          kind: _BlockKind.h1,
          spans: _inlineSpans(line.substring(2)),
          spacingBefore: blocks.isEmpty ? 0 : 20,
        ),
      );
      continue;
    }
    if (body.isNotEmpty) {
      body.write('\n');
    }
    body.write(line);
  }
  flushBody();
  return blocks;
}

List<InlineSpan> _inlineSpans(String input) {
  final spans = <InlineSpan>[];
  final pattern = RegExp(r'\*\*(.+?)\*\*');
  var start = 0;
  for (final match in pattern.allMatches(input)) {
    if (match.start > start) {
      spans.add(TextSpan(text: input.substring(start, match.start)));
    }
    spans.add(
      TextSpan(
        text: match.group(1),
        style: const TextStyle(fontWeight: FontWeight.w700),
      ),
    );
    start = match.end;
  }
  if (start < input.length) {
    spans.add(TextSpan(text: input.substring(start)));
  }
  if (spans.isEmpty) {
    spans.add(const TextSpan(text: ''));
  }
  return spans;
}
