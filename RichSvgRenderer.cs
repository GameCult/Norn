using System.Globalization;
using System.Net;
using System.Text;
using Microsoft.Msagl.Core.Geometry.Curves;
using Microsoft.Msagl.Drawing;

static class RichSvgRenderer
{
    public static string Render(LayoutReport report, Graph graph)
    {
        var theme = Theme.For(report.GraphKey);
        var degreeByNodeId = CalculateDegrees(report);
        var layout = LayoutFrame.Create(report);
        var nodes = report.Nodes
            .Select(node => NodeVisual.Create(node, layout, theme, degreeByNodeId.GetValueOrDefault(node.Id)))
            .ToArray();
        var nodeLookup = nodes.ToDictionary(node => node.Id, StringComparer.OrdinalIgnoreCase);

        var document = new StringBuilder();
        document.AppendLine("""<?xml version="1.0" encoding="utf-8"?>""");
        document.AppendLine(
            $"""<svg xmlns="http://www.w3.org/2000/svg" width="{Fmt(layout.CanvasWidth)}" height="{Fmt(layout.CanvasHeight)}" viewBox="0 0 {Fmt(layout.CanvasWidth)} {Fmt(layout.CanvasHeight)}" role="img" aria-labelledby="title desc">""");
        AppendDefs(document, theme);
        document.AppendLine($"""  <title id="title">{Escape(report.GraphTitle)} ({Escape(report.GraphKey)})</title>""");
        document.AppendLine(
            $"""  <desc id="desc">EpiphanyGraph custom renderer output for {Escape(report.GraphKey)} using {Escape(report.LayoutMode)} layout with {report.NodeCount} nodes and {report.EdgeCount} edges.</desc>""");
        document.AppendLine($"""  <rect x="0" y="0" width="{Fmt(layout.CanvasWidth)}" height="{Fmt(layout.CanvasHeight)}" fill="url(#bg-gradient)" />""");
        document.AppendLine($"""  <rect x="0" y="0" width="{Fmt(layout.CanvasWidth)}" height="{Fmt(layout.CanvasHeight)}" fill="url(#bg-noise)" opacity="0.18" />""");
        document.AppendLine($"""  <rect x="{Fmt(layout.GraphAreaX - 18)}" y="{Fmt(layout.GraphAreaY - 18)}" width="{Fmt(layout.GraphAreaWidth + 36)}" height="{Fmt(layout.GraphAreaHeight + 36)}" rx="28" fill="{theme.GraphPanelFill}" fill-opacity="0.72" stroke="{theme.GraphPanelStroke}" stroke-opacity="0.5" />""");
        AppendDepthGuides(document, report, layout, theme);
        AppendHeader(document, report, layout, theme);
        AppendEdges(document, graph, nodeLookup, layout, theme);
        AppendNodes(document, nodes, theme);
        AppendLegend(document, report, layout, theme);
        document.AppendLine("</svg>");
        return document.ToString();
    }

    private static void AppendDefs(StringBuilder document, Theme theme)
    {
        document.AppendLine("  <defs>");
        document.AppendLine($"""    <linearGradient id="bg-gradient" x1="0%" y1="0%" x2="100%" y2="100%">""");
        document.AppendLine($"""      <stop offset="0%" stop-color="{theme.BackgroundStart}" />""");
        document.AppendLine($"""      <stop offset="58%" stop-color="{theme.BackgroundMid}" />""");
        document.AppendLine($"""      <stop offset="100%" stop-color="{theme.BackgroundEnd}" />""");
        document.AppendLine("    </linearGradient>");
        document.AppendLine("""    <radialGradient id="bg-noise" cx="50%" cy="40%" r="80%">""");
        document.AppendLine("""      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.28" />""");
        document.AppendLine("""      <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />""");
        document.AppendLine("    </radialGradient>");
        document.AppendLine($"""    <filter id="node-glow" x="-40%" y="-40%" width="180%" height="180%">""");
        document.AppendLine($"""      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="{theme.GlowColor}" flood-opacity="0.18" />""");
        document.AppendLine("    </filter>");
        document.AppendLine("""    <filter id="entry-glow" x="-80%" y="-80%" width="260%" height="260%">""");
        document.AppendLine("""      <feDropShadow dx="0" dy="0" stdDeviation="8" flood-color="#FDE68A" flood-opacity="0.52" />""");
        document.AppendLine("""      <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#F59E0B" flood-opacity="0.22" />""");
        document.AppendLine("    </filter>");
        document.AppendLine($"""    <marker id="arrow-accent" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto-start-reverse">""");
        document.AppendLine($"""      <path d="M 0 0 L 12 6 L 0 12 z" fill="{theme.EdgeAccent}" />""");
        document.AppendLine("    </marker>");
        document.AppendLine("""    <marker id="arrow-muted" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto-start-reverse">""");
        document.AppendLine("""      <path d="M 0 0 L 12 6 L 0 12 z" fill="#94A3B8" />""");
        document.AppendLine("    </marker>");
        document.AppendLine("  </defs>");
    }

    private static void AppendDepthGuides(StringBuilder document, LayoutReport report, LayoutFrame layout, Theme theme)
    {
        var depths = report.Nodes
            .Select(node => node.Depth)
            .Where(depth => depth >= 0)
            .Distinct()
            .OrderBy(depth => depth)
            .ToArray();

        if (depths.Length == 0)
        {
            return;
        }

        var depthMax = depths.Max();
        document.AppendLine("""  <g id="depth-guides" opacity="0.7">""");

        foreach (var depth in depths)
        {
            var y = layout.GraphAreaY + (layout.GraphAreaHeight * ((depth + 0.5) / (depthMax + 1.0)));
            var lineColor = theme.GetDepthAccent(depth, GraphPartitionNodeRole.Primary.ToApiValue());
            document.AppendLine(
                $"""    <line x1="{Fmt(layout.GraphAreaX)}" y1="{Fmt(y)}" x2="{Fmt(layout.GraphAreaX + layout.GraphAreaWidth)}" y2="{Fmt(y)}" stroke="{lineColor}" stroke-opacity="0.12" stroke-width="1.2" stroke-dasharray="6 10" />""");
            document.AppendLine(
                $"""    <text x="{Fmt(layout.GraphAreaX + 10)}" y="{Fmt(y - 8)}" fill="{lineColor}" fill-opacity="0.58" font-family="{theme.FontFamily}" font-size="11" letter-spacing="0.18em">DEPTH {depth}</text>""");
        }

        document.AppendLine("  </g>");
    }

    private static void AppendHeader(StringBuilder document, LayoutReport report, LayoutFrame layout, Theme theme)
    {
        var familyLabel = report.GraphKey.Equals("control-flow", StringComparison.OrdinalIgnoreCase)
            ? "CONTROL FLOW"
            : "SOURCE TREE";
        var subtitle = $"{report.LayoutMode.ToUpperInvariant()} layout | rich renderer | {report.NodeCount} nodes | {report.EdgeCount} edges";

        document.AppendLine("""  <g id="header">""");
        document.AppendLine(
            $"""    <rect x="{Fmt(layout.GraphAreaX)}" y="24" width="{Fmt(layout.GraphAreaWidth)}" height="66" rx="24" fill="{theme.HeaderFill}" fill-opacity="0.82" stroke="{theme.HeaderStroke}" stroke-opacity="0.55" />""");
        document.AppendLine(
            $"""    <text x="{Fmt(layout.GraphAreaX + 24)}" y="53" fill="{theme.HeaderText}" font-family="{theme.FontFamily}" font-size="30" font-weight="700">{Escape(report.GraphTitle)}</text>""");
        document.AppendLine(
            $"""    <text x="{Fmt(layout.GraphAreaX + 24)}" y="76" fill="{theme.MutedText}" font-family="{theme.FontFamily}" font-size="12" letter-spacing="0.18em">{Escape(subtitle)}</text>""");
        document.AppendLine(
            $"""    <rect x="{Fmt(layout.SidebarX + 22)}" y="34" width="154" height="26" rx="13" fill="{theme.PillFill}" stroke="{theme.PillStroke}" stroke-opacity="0.5" />""");
        document.AppendLine(
            $"""    <text x="{Fmt(layout.SidebarX + 99)}" y="52" text-anchor="middle" fill="{theme.HeaderText}" font-family="{theme.FontFamily}" font-size="12" font-weight="700" letter-spacing="0.18em">{familyLabel}</text>""");
        document.AppendLine("  </g>");
    }

    private static void AppendEdges(
        StringBuilder document,
        Graph graph,
        IReadOnlyDictionary<string, NodeVisual> nodeLookup,
        LayoutFrame layout,
        Theme theme)
    {
        document.AppendLine("""  <g id="edges" fill="none">""");

        foreach (var edge in graph.Edges)
        {
            if (!nodeLookup.TryGetValue(edge.SourceNode.Id, out var source) || !nodeLookup.TryGetValue(edge.TargetNode.Id, out var target))
            {
                continue;
            }

            var isMuted = source.Role == GraphPartitionNodeRole.Anchor.ToApiValue() || target.Role == GraphPartitionNodeRole.Anchor.ToApiValue();
            var path = BuildEdgePath(edge, source, target, layout);
            var stroke = isMuted ? "#94A3B8" : theme.EdgeAccent;
            var opacity = isMuted ? "0.28" : "0.52";
            var width = isMuted ? "1.3" : "1.8";
            var marker = isMuted ? "url(#arrow-muted)" : "url(#arrow-accent)";

            document.AppendLine(
                $"""    <path id="{ToDomId("edge", edge.SourceNode.Id, edge.TargetNode.Id)}" class="edge {(isMuted ? "edge-muted" : "edge-primary")}" data-source-id="{Escape(edge.SourceNode.Id)}" data-target-id="{Escape(edge.TargetNode.Id)}" d="{path}" stroke="{stroke}" stroke-opacity="{opacity}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round" marker-end="{marker}" />""");
        }

        document.AppendLine("  </g>");
    }

    private static void AppendNodes(StringBuilder document, IReadOnlyList<NodeVisual> nodes, Theme theme)
    {
        document.AppendLine("""  <g id="nodes">""");

        foreach (var node in nodes.OrderBy(node => node.Role == GraphPartitionNodeRole.Anchor.ToApiValue()).ThenBy(node => node.Depth).ThenBy(node => node.Id, StringComparer.OrdinalIgnoreCase))
        {
            var titleLines = WrapLabel(node.Title, node.TitleCharacterLimit, 3);
            var titleY = node.Y + 31;
            var titleX = node.X + 18;
            var bandHeight = Math.Min(10, Math.Max(6, node.Height * 0.16));
            var badgeVisible = node.DegreeBadgeVisible;
            var badgeRadius = 12.5;
            var badgeCx = node.X + node.Width - 18;
            var badgeCy = node.Y + 18;
            var groupFilter = node.IsEntry ? "url(#entry-glow)" : "url(#node-glow)";

            document.AppendLine(
                $"""    <g id="{ToDomId("node", node.Id)}" class="node node-{Escape(node.Role)}" data-node-id="{Escape(node.Id)}" data-depth="{node.Depth}" data-role="{Escape(node.Role)}" data-degree="{node.Degree}" filter="{groupFilter}">""");

            if (node.IsEntry)
            {
                document.AppendLine(
                    $"""      <rect x="{Fmt(node.X - 6)}" y="{Fmt(node.Y - 6)}" width="{Fmt(node.Width + 12)}" height="{Fmt(node.Height + 12)}" rx="{Fmt(node.CornerRadius + 6)}" fill="none" stroke="#FDE68A" stroke-opacity="0.88" stroke-width="2.2" />""");
            }

            document.AppendLine(
                $"""      <rect x="{Fmt(node.X)}" y="{Fmt(node.Y)}" width="{Fmt(node.Width)}" height="{Fmt(node.Height)}" rx="{Fmt(node.CornerRadius)}" fill="{node.PanelFill}" fill-opacity="{node.PanelOpacity}" stroke="{node.Stroke}" stroke-opacity="0.95" stroke-width="{node.StrokeWidth}" />""");
            document.AppendLine(
                $"""      <rect x="{Fmt(node.X + 1.5)}" y="{Fmt(node.Y + 1.5)}" width="{Fmt(node.Width - 3)}" height="{Fmt(bandHeight)}" rx="{Fmt(node.CornerRadius - 1.5)}" fill="{node.Accent}" fill-opacity="0.7" />""");
            document.AppendLine(
                $"""      <circle cx="{Fmt(node.X + 18)}" cy="{Fmt(node.Y + 20)}" r="9" fill="{node.Accent}" fill-opacity="0.94" stroke="{node.IconStroke}" stroke-opacity="0.9" stroke-width="1.2" />""");
            document.AppendLine(
                $"""      <text x="{Fmt(node.X + 18)}" y="{Fmt(node.Y + 24.5)}" text-anchor="middle" fill="{node.IconText}" font-family="{theme.FontFamily}" font-size="9.5" font-weight="700">{Escape(node.IconTextValue)}</text>""");

            if (badgeVisible)
            {
                document.AppendLine(
                    $"""      <circle cx="{Fmt(badgeCx)}" cy="{Fmt(badgeCy)}" r="{Fmt(badgeRadius)}" fill="{theme.BadgeFill}" fill-opacity="0.95" stroke="{node.Accent}" stroke-width="1.4" />""");
                document.AppendLine(
                    $"""      <text x="{Fmt(badgeCx)}" y="{Fmt(badgeCy + 4.5)}" text-anchor="middle" fill="{theme.BadgeText}" font-family="{theme.FontFamily}" font-size="11" font-weight="700">{node.Degree}</text>""");
            }

            for (var i = 0; i < titleLines.Count; i++)
            {
                document.AppendLine(
                    $"""      <text x="{Fmt(titleX)}" y="{Fmt(titleY + i * 16)}" fill="{node.TitleColor}" font-family="{theme.FontFamily}" font-size="{Fmt(node.TitleFontSize)}" font-weight="600">{Escape(titleLines[i])}</text>""");
            }

            document.AppendLine(
                $"""      <text x="{Fmt(titleX)}" y="{Fmt(node.Y + node.Height - 16)}" fill="{theme.MutedText}" fill-opacity="0.86" font-family="{theme.FontFamily}" font-size="10.5" letter-spacing="0.12em">{Escape(node.Subtitle)}</text>""");
            document.AppendLine("    </g>");
        }

        document.AppendLine("  </g>");
    }

    private static void AppendLegend(StringBuilder document, LayoutReport report, LayoutFrame layout, Theme theme)
    {
        document.AppendLine("""  <g id="legend">""");
        document.AppendLine(
            $"""    <rect x="{Fmt(layout.SidebarX)}" y="{Fmt(layout.GraphAreaY)}" width="{Fmt(layout.SidebarWidth)}" height="{Fmt(layout.GraphAreaHeight)}" rx="28" fill="{theme.SidebarFill}" fill-opacity="0.88" stroke="{theme.SidebarStroke}" stroke-opacity="0.65" />""");
        document.AppendLine(
            $"""    <text x="{Fmt(layout.SidebarX + 24)}" y="{Fmt(layout.GraphAreaY + 34)}" fill="{theme.HeaderText}" font-family="{theme.FontFamily}" font-size="20" font-weight="700">Render Notes</text>""");
        document.AppendLine(
            $"""    <text x="{Fmt(layout.SidebarX + 24)}" y="{Fmt(layout.GraphAreaY + 56)}" fill="{theme.MutedText}" font-family="{theme.FontFamily}" font-size="11.5">custom SVG over MSAGL coordinates</text>""");

        AppendLegendStat(document, layout.SidebarX + 24, layout.GraphAreaY + 96, "Nodes", report.NodeCount.ToString(CultureInfo.InvariantCulture), theme);
        AppendLegendStat(document, layout.SidebarX + 24, layout.GraphAreaY + 142, "Edges", report.EdgeCount.ToString(CultureInfo.InvariantCulture), theme);
        AppendLegendStat(document, layout.SidebarX + 24, layout.GraphAreaY + 188, "Layout", report.LayoutMode.ToUpperInvariant(), theme);

        var swatchY = layout.GraphAreaY + 256;
        AppendLegendSwatch(document, layout.SidebarX + 24, swatchY, theme.EntryAccent, "Entry", "seed or canonical root", theme);
        AppendLegendSwatch(document, layout.SidebarX + 24, swatchY + 48, theme.GetDepthAccent(2, GraphPartitionNodeRole.Primary.ToApiValue()), "Primary", "main partition member", theme);
        AppendLegendSwatch(document, layout.SidebarX + 24, swatchY + 96, "#94A3B8", "Anchor", "cross-family tether node", theme);
        AppendLegendSwatch(document, layout.SidebarX + 24, swatchY + 144, theme.BadgeFill, "Degree Badge", "total edge count on node", theme);

        document.AppendLine(
            $"""    <text x="{Fmt(layout.SidebarX + 24)}" y="{Fmt(layout.GraphAreaY + layout.GraphAreaHeight - 58)}" fill="{theme.MutedText}" font-family="{theme.FontFamily}" font-size="11">The raw MSAGL SVG still exists. This one is just trying harder.</text>""");
        document.AppendLine(
            $"""    <text x="{Fmt(layout.SidebarX + 24)}" y="{Fmt(layout.GraphAreaY + layout.GraphAreaHeight - 34)}" fill="{theme.MutedText}" font-family="{theme.FontFamily}" font-size="11">Use the benchmark to decide whether it earned the extra attitude.</text>""");
        document.AppendLine("  </g>");
    }

    private static void AppendLegendStat(StringBuilder document, double x, double y, string label, string value, Theme theme)
    {
        document.AppendLine(
            $"""    <rect x="{Fmt(x)}" y="{Fmt(y)}" width="232" height="34" rx="17" fill="{theme.StatFill}" fill-opacity="0.92" stroke="{theme.StatStroke}" stroke-opacity="0.5" />""");
        document.AppendLine(
            $"""    <text x="{Fmt(x + 16)}" y="{Fmt(y + 22)}" fill="{theme.MutedText}" font-family="{theme.FontFamily}" font-size="11" letter-spacing="0.16em">{Escape(label.ToUpperInvariant())}</text>""");
        document.AppendLine(
            $"""    <text x="{Fmt(x + 216)}" y="{Fmt(y + 23)}" text-anchor="end" fill="{theme.HeaderText}" font-family="{theme.FontFamily}" font-size="14" font-weight="700">{Escape(value)}</text>""");
    }

    private static void AppendLegendSwatch(StringBuilder document, double x, double y, string color, string label, string note, Theme theme)
    {
        document.AppendLine(
            $"""    <circle cx="{Fmt(x + 10)}" cy="{Fmt(y)}" r="8" fill="{color}" stroke="{theme.SidebarStroke}" stroke-opacity="0.35" />""");
        document.AppendLine(
            $"""    <text x="{Fmt(x + 28)}" y="{Fmt(y + 4)}" fill="{theme.HeaderText}" font-family="{theme.FontFamily}" font-size="13" font-weight="600">{Escape(label)}</text>""");
        document.AppendLine(
            $"""    <text x="{Fmt(x + 28)}" y="{Fmt(y + 20)}" fill="{theme.MutedText}" font-family="{theme.FontFamily}" font-size="11">{Escape(note)}</text>""");
    }

    private static string BuildEdgePath(Edge edge, NodeVisual source, NodeVisual target, LayoutFrame layout)
    {
        var curve = edge.EdgeCurve ?? edge.GeometryEdge?.Curve;
        if (curve is not null)
        {
            return SampleCurvePath(curve, layout);
        }

        return BuildFallbackEdgePath(source, target);
    }

    private static string SampleCurvePath(ICurve curve, LayoutFrame layout)
    {
        var sampleCount = Math.Clamp((int)Math.Ceiling(curve.Length / 28.0), 8, 64);
        var parameters = Enumerable.Range(0, sampleCount + 1)
            .Select(index => curve.ParStart + ((curve.ParEnd - curve.ParStart) * index / sampleCount))
            .ToArray();
        var points = parameters
            .Select(parameter => TransformPoint(curve[parameter], layout))
            .ToArray();

        if (points.Length == 0)
        {
            return string.Empty;
        }

        var builder = new StringBuilder();
        builder.Append($"M {Fmt(points[0].X)} {Fmt(points[0].Y)}");
        for (var i = 1; i < points.Length; i++)
        {
            builder.Append($" L {Fmt(points[i].X)} {Fmt(points[i].Y)}");
        }

        return builder.ToString();
    }

    private static string BuildFallbackEdgePath(NodeVisual source, NodeVisual target)
    {
        var dx = target.CenterX - source.CenterX;
        var dy = target.CenterY - source.CenterY;
        var start = ResolveRectAnchor(source.CenterX, source.CenterY, source.Width / 2.0, source.Height / 2.0, dx, dy);
        var end = ResolveRectAnchor(target.CenterX, target.CenterY, target.Width / 2.0, target.Height / 2.0, -dx, -dy);

        var controlRatio = Math.Abs(dx) > Math.Abs(dy) ? 0.34 : 0.18;
        var c1x = start.X + dx * controlRatio;
        var c1y = start.Y + dy * 0.08;
        var c2x = end.X - dx * controlRatio;
        var c2y = end.Y - dy * 0.08;

        return $"M {Fmt(start.X)} {Fmt(start.Y)} C {Fmt(c1x)} {Fmt(c1y)}, {Fmt(c2x)} {Fmt(c2y)}, {Fmt(end.X)} {Fmt(end.Y)}";
    }

    private static (double X, double Y) TransformPoint(Microsoft.Msagl.Core.Geometry.Point point, LayoutFrame layout) =>
        (
            X: layout.GraphAreaX + (point.X - layout.MinLeft),
            Y: layout.GraphAreaY + (layout.MaxTop - point.Y)
        );

    private static (double X, double Y) ResolveRectAnchor(double centerX, double centerY, double halfWidth, double halfHeight, double dx, double dy)
    {
        if (Math.Abs(dx) < 0.001 && Math.Abs(dy) < 0.001)
        {
            return (centerX, centerY);
        }

        var scale = 1.0 / Math.Max(Math.Abs(dx) / Math.Max(halfWidth, 1), Math.Abs(dy) / Math.Max(halfHeight, 1));
        return (centerX + dx * scale, centerY + dy * scale);
    }

    private static Dictionary<string, int> CalculateDegrees(LayoutReport report)
    {
        var degrees = report.Nodes.ToDictionary(node => node.Id, _ => 0, StringComparer.OrdinalIgnoreCase);
        foreach (var edge in report.Edges)
        {
            degrees[edge.SourceId] = degrees.GetValueOrDefault(edge.SourceId) + 1;
            degrees[edge.TargetId] = degrees.GetValueOrDefault(edge.TargetId) + 1;
        }

        return degrees;
    }

    private static IReadOnlyList<string> WrapLabel(string label, int maxChars, int maxLines)
    {
        if (string.IsNullOrWhiteSpace(label))
        {
            return ["Untitled"];
        }

        var tokens = label.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (tokens.Length == 0)
        {
            return [label];
        }

        var lines = new List<string>();
        var current = new StringBuilder();

        foreach (var token in tokens)
        {
            if (token.Length > maxChars)
            {
                Flush();
                foreach (var chunk in SplitLongToken(token, maxChars))
                {
                    lines.Add(chunk);
                    if (lines.Count == maxLines)
                    {
                        lines[^1] = Ellipsize(lines[^1], maxChars);
                        return lines;
                    }
                }

                continue;
            }

            var candidateLength = current.Length == 0 ? token.Length : current.Length + 1 + token.Length;
            if (candidateLength > maxChars)
            {
                Flush();
            }

            if (current.Length > 0)
            {
                current.Append(' ');
            }

            current.Append(token);
        }

        Flush();

        if (lines.Count > maxLines)
        {
            lines = lines.Take(maxLines).ToList();
        }

        if (lines.Count == maxLines && tokens.Length > 0)
        {
            lines[^1] = Ellipsize(lines[^1], maxChars);
        }

        return lines;

        void Flush()
        {
            if (current.Length == 0)
            {
                return;
            }

            lines.Add(current.ToString());
            current.Clear();
        }
    }

    private static IEnumerable<string> SplitLongToken(string token, int maxChars)
    {
        for (var i = 0; i < token.Length; i += maxChars)
        {
            var length = Math.Min(maxChars, token.Length - i);
            yield return token.Substring(i, length);
        }
    }

    private static string Ellipsize(string value, int maxChars)
    {
        if (value.Length <= maxChars)
        {
            return value;
        }

        if (maxChars <= 1)
        {
            return "…";
        }

        return $"{value[..(maxChars - 1)]}…";
    }

    private static string Fmt(double value) => value.ToString("0.##", CultureInfo.InvariantCulture);

    private static string Escape(string value) => WebUtility.HtmlEncode(value);

    private static string ToDomId(string prefix, params string[] values)
    {
        var joined = string.Join("-", values);
        var normalized = new string(joined
            .Select(ch => char.IsLetterOrDigit(ch) ? char.ToLowerInvariant(ch) : '-')
            .ToArray());
        while (normalized.Contains("--", StringComparison.Ordinal))
        {
            normalized = normalized.Replace("--", "-", StringComparison.Ordinal);
        }

        return $"{prefix}-{normalized.Trim('-')}";
    }

    private sealed record LayoutFrame(
        double CanvasWidth,
        double CanvasHeight,
        double GraphAreaX,
        double GraphAreaY,
        double GraphAreaWidth,
        double GraphAreaHeight,
        double SidebarX,
        double SidebarWidth,
        double MinLeft,
        double MaxTop)
    {
        public static LayoutFrame Create(LayoutReport report)
        {
            const double outerPadding = 54;
            const double headerHeight = 108;
            const double footerHeight = 38;
            const double sidebarWidth = 280;
            const double sidebarGap = 30;

            var minLeft = report.Nodes.Min(node => node.Bounds.Left);
            var maxRight = report.Nodes.Max(node => node.Bounds.Left + node.Bounds.Width);
            var maxTop = report.Nodes.Max(node => node.Bounds.Bottom + node.Bounds.Height);
            var minBottom = report.Nodes.Min(node => node.Bounds.Bottom);

            var graphWidth = Math.Max(640, maxRight - minLeft);
            var graphHeight = Math.Max(520, maxTop - minBottom);
            var graphAreaX = outerPadding;
            var graphAreaY = headerHeight;
            var canvasWidth = outerPadding * 2 + graphWidth + sidebarGap + sidebarWidth;
            var canvasHeight = graphAreaY + graphHeight + outerPadding + footerHeight;
            var sidebarX = graphAreaX + graphWidth + sidebarGap;

            return new LayoutFrame(
                CanvasWidth: canvasWidth,
                CanvasHeight: canvasHeight,
                GraphAreaX: graphAreaX,
                GraphAreaY: graphAreaY,
                GraphAreaWidth: graphWidth,
                GraphAreaHeight: graphHeight,
                SidebarX: sidebarX,
                SidebarWidth: sidebarWidth,
                MinLeft: minLeft,
                MaxTop: maxTop);
        }
    }

    private sealed record NodeVisual(
        string Id,
        string Title,
        int Depth,
        string Role,
        bool IsEntry,
        int Degree,
        bool DegreeBadgeVisible,
        double X,
        double Y,
        double Width,
        double Height,
        double CenterX,
        double CenterY,
        double CornerRadius,
        double StrokeWidth,
        double TitleFontSize,
        int TitleCharacterLimit,
        string Subtitle,
        string PanelFill,
        string PanelOpacity,
        string Stroke,
        string Accent,
        string TitleColor,
        string IconStroke,
        string IconText,
        string IconTextValue)
    {
        public static NodeVisual Create(LayoutNodeRecord node, LayoutFrame layout, Theme theme, int degree)
        {
            var x = layout.GraphAreaX + (node.Bounds.Left - layout.MinLeft);
            var y = layout.GraphAreaY + (layout.MaxTop - (node.Bounds.Bottom + node.Bounds.Height));
            var accent = theme.GetDepthAccent(node.Depth, node.Role, node.IsEntry);
            var isAnchor = node.Role == GraphPartitionNodeRole.Anchor.ToApiValue();
            var subtitle = node.IsEntry
                ? "ENTRY NODE"
                : isAnchor
                    ? "ANCHOR"
                    : $"DEPTH {Math.Max(node.Depth, 0)}";
            var characterLimit = Math.Clamp((int)Math.Floor((node.Bounds.Width - 38) / 7.15), 12, 28);
            var degreeBadgeVisible = degree >= 3 || node.IsEntry;

            return new NodeVisual(
                Id: node.Id,
                Title: node.Title,
                Depth: node.Depth,
                Role: node.Role,
                IsEntry: node.IsEntry,
                Degree: degree,
                DegreeBadgeVisible: degreeBadgeVisible,
                X: x,
                Y: y,
                Width: node.Bounds.Width,
                Height: node.Bounds.Height,
                CenterX: x + node.Bounds.Width / 2.0,
                CenterY: y + node.Bounds.Height / 2.0,
                CornerRadius: isAnchor ? 18 : 22,
                StrokeWidth: node.IsEntry ? 2.1 : isAnchor ? 1.25 : 1.55,
                TitleFontSize: isAnchor ? 11.5 : node.IsEntry ? 15 : 13.5,
                TitleCharacterLimit: characterLimit,
                Subtitle: subtitle,
                PanelFill: isAnchor ? "#111827" : "#08111F",
                PanelOpacity: isAnchor ? "0.78" : "0.88",
                Stroke: node.IsEntry ? theme.EntryAccent : isAnchor ? "#94A3B8" : accent,
                Accent: node.IsEntry ? theme.EntryAccent : accent,
                TitleColor: node.IsEntry ? "#FFF8E8" : "#F8FAFC",
                IconStroke: isAnchor ? "#E2E8F0" : "#FFFFFF",
                IconText: isAnchor ? "#0F172A" : "#08111F",
                IconTextValue: node.IsEntry ? "E" : isAnchor ? "A" : theme.IconLetter);
        }
    }

    private sealed record Theme(
        string FontFamily,
        string BackgroundStart,
        string BackgroundMid,
        string BackgroundEnd,
        string GraphPanelFill,
        string GraphPanelStroke,
        string HeaderFill,
        string HeaderStroke,
        string HeaderText,
        string MutedText,
        string GlowColor,
        string SidebarFill,
        string SidebarStroke,
        string StatFill,
        string StatStroke,
        string PillFill,
        string PillStroke,
        string BadgeFill,
        string BadgeText,
        string EdgeAccent,
        string EntryAccent,
        string IconLetter,
        IReadOnlyList<string> PrimaryDepthPalette)
    {
        public static Theme For(string graphKey)
        {
            if (graphKey.Equals("control-flow", StringComparison.OrdinalIgnoreCase))
            {
                return new Theme(
                    FontFamily: "Bahnschrift, Segoe UI, sans-serif",
                    BackgroundStart: "#070C15",
                    BackgroundMid: "#161022",
                    BackgroundEnd: "#291017",
                    GraphPanelFill: "#0A1020",
                    GraphPanelStroke: "#F97316",
                    HeaderFill: "#120E1C",
                    HeaderStroke: "#FB7185",
                    HeaderText: "#FFF7ED",
                    MutedText: "#FDBA74",
                    GlowColor: "#FB7185",
                    SidebarFill: "#0B1120",
                    SidebarStroke: "#F97316",
                    StatFill: "#111827",
                    StatStroke: "#FB7185",
                    PillFill: "#2B1320",
                    PillStroke: "#FB7185",
                    BadgeFill: "#180E1D",
                    BadgeText: "#FFF7ED",
                    EdgeAccent: "#FB7185",
                    EntryAccent: "#FDE68A",
                    IconLetter: "C",
                    PrimaryDepthPalette:
                    [
                        "#FB7185",
                        "#F97316",
                        "#F59E0B",
                        "#FDE68A",
                        "#67E8F9",
                        "#A78BFA"
                    ]);
            }

            return new Theme(
                FontFamily: "Bahnschrift, Segoe UI, sans-serif",
                BackgroundStart: "#061019",
                BackgroundMid: "#0B1529",
                BackgroundEnd: "#111827",
                GraphPanelFill: "#08131F",
                GraphPanelStroke: "#22D3EE",
                HeaderFill: "#091525",
                HeaderStroke: "#38BDF8",
                HeaderText: "#F8FAFC",
                MutedText: "#A5F3FC",
                GlowColor: "#22D3EE",
                SidebarFill: "#09131F",
                SidebarStroke: "#22D3EE",
                StatFill: "#0F172A",
                StatStroke: "#38BDF8",
                PillFill: "#10263C",
                PillStroke: "#22D3EE",
                BadgeFill: "#0B1220",
                BadgeText: "#F8FAFC",
                EdgeAccent: "#22D3EE",
                EntryAccent: "#FDE68A",
                IconLetter: "S",
                PrimaryDepthPalette:
                [
                    "#38BDF8",
                    "#22D3EE",
                    "#2DD4BF",
                    "#86EFAC",
                    "#C4B5FD",
                    "#F9A8D4"
                ]);
        }

        public string GetDepthAccent(int depth, string role, bool isEntry = false)
        {
            if (isEntry)
            {
                return EntryAccent;
            }

            if (role == GraphPartitionNodeRole.Anchor.ToApiValue())
            {
                return "#94A3B8";
            }

            if (PrimaryDepthPalette.Count == 0)
            {
                return EdgeAccent;
            }

            if (depth < 0)
            {
                return PrimaryDepthPalette[^1];
            }

            return PrimaryDepthPalette[depth % PrimaryDepthPalette.Count];
        }
    }
}
