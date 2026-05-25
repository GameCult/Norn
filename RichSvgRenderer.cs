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
        var degreeByNodeId = CalculateDegrees(graph);
        var rawNodes = BuildRawNodes(report, graph, degreeByNodeId);
        var projection = Projection.Create(report, rawNodes);
        var projectedNodes = rawNodes
            .Select(node => ProjectedNode.Create(node, projection, theme))
            .ToArray();
        var projectedLookup = projectedNodes.ToDictionary(node => node.Id, StringComparer.OrdinalIgnoreCase);
        var canvas = CanvasLayout.Create(projectedNodes);

        var document = new StringBuilder();
        document.AppendLine("""<?xml version="1.0" encoding="utf-8"?>""");
        document.AppendLine(
            $"""<svg xmlns="http://www.w3.org/2000/svg" width="{Fmt(canvas.Width)}" height="{Fmt(canvas.Height)}" viewBox="0 0 {Fmt(canvas.Width)} {Fmt(canvas.Height)}" role="img" aria-labelledby="title desc">""");
        AppendDefs(document, theme);
        document.AppendLine($"""  <title id="title">{Escape(report.GraphTitle)} ({Escape(report.GraphKey)})</title>""");
        document.AppendLine(
            $"""  <desc id="desc">Norn rich renderer output for {Escape(report.GraphKey)} using {Escape(report.LayoutMode)} layout with {report.NodeCount} nodes and {report.EdgeCount} edges.</desc>""");
        document.AppendLine($"""  <rect x="0" y="0" width="{Fmt(canvas.Width)}" height="{Fmt(canvas.Height)}" fill="url(#bg-gradient)" />""");
        document.AppendLine($"""  <rect x="0" y="0" width="{Fmt(canvas.Width)}" height="{Fmt(canvas.Height)}" fill="url(#bg-vignette)" opacity="0.18" />""");
        AppendGuides(document, report, rawNodes, projection, canvas, theme);
        AppendHeader(document, report, canvas, theme);
        AppendEdges(document, graph, projectedLookup, projection, canvas, theme);
        AppendNodes(document, projectedNodes, canvas, theme);
        AppendOverlay(document, report, canvas, theme);
        document.AppendLine("</svg>");
        return document.ToString();
    }

    private static IReadOnlyList<RawNode> BuildRawNodes(
        LayoutReport report,
        Graph graph,
        IReadOnlyDictionary<string, int> degreeByNodeId)
    {
        var reportNodes = report.Nodes.ToDictionary(node => node.Id, StringComparer.OrdinalIgnoreCase);
        return graph.Nodes
            .Select(node =>
            {
                var record = reportNodes[node.Id];
                var center = node.BoundingBox.Center;
                var category = SemanticCategoryClassifier.Classify(report.GraphKey, record.Title, record.Role, record.IsEntry);
                return new RawNode(
                    Id: record.Id,
                    Title: record.Title,
                    Depth: record.Depth,
                    Role: record.Role,
                    IsEntry: record.IsEntry,
                    Degree: degreeByNodeId.GetValueOrDefault(record.Id),
                    Category: category,
                    Token: CreateToken(record.Title, record.Role, record.IsEntry),
                    RawX: center.X,
                    RawY: center.Y);
            })
            .OrderBy(node => node.Depth)
            .ThenBy(node => node.Id, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static void AppendDefs(StringBuilder document, Theme theme)
    {
        document.AppendLine("  <defs>");
        document.AppendLine("""    <linearGradient id="bg-gradient" x1="0%" y1="0%" x2="100%" y2="100%">""");
        document.AppendLine($"""      <stop offset="0%" stop-color="{theme.BackgroundStart}" />""");
        document.AppendLine($"""      <stop offset="56%" stop-color="{theme.BackgroundMid}" />""");
        document.AppendLine($"""      <stop offset="100%" stop-color="{theme.BackgroundEnd}" />""");
        document.AppendLine("    </linearGradient>");
        document.AppendLine("""    <radialGradient id="bg-vignette" cx="50%" cy="42%" r="78%">""");
        document.AppendLine("""      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.22" />""");
        document.AppendLine("""      <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />""");
        document.AppendLine("    </radialGradient>");
        document.AppendLine("""    <filter id="node-soft-glow" x="-60%" y="-60%" width="220%" height="220%">""");
        document.AppendLine($"""      <feDropShadow dx="0" dy="0" stdDeviation="7" flood-color="{theme.GlowColor}" flood-opacity="0.28" />""");
        document.AppendLine("    </filter>");
        document.AppendLine("""    <filter id="entry-glow" x="-100%" y="-100%" width="300%" height="300%">""");
        document.AppendLine("""      <feDropShadow dx="0" dy="0" stdDeviation="11" flood-color="#FDE68A" flood-opacity="0.52" />""");
        document.AppendLine("""      <feDropShadow dx="0" dy="10" stdDeviation="18" flood-color="#F59E0B" flood-opacity="0.18" />""");
        document.AppendLine("    </filter>");
        document.AppendLine($"""    <marker id="edge-arrow" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto-start-reverse">""");
        document.AppendLine($"""      <path d="M 0 0 L 12 6 L 0 12 z" fill="{theme.EdgeStroke}" />""");
        document.AppendLine("    </marker>");
        document.AppendLine($"""    <marker id="edge-arrow-muted" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="7" markerHeight="7" orient="auto-start-reverse">""");
        document.AppendLine("""      <path d="M 0 0 L 12 6 L 0 12 z" fill="#94A3B8" />""");
        document.AppendLine("    </marker>");
        document.AppendLine("  </defs>");
    }

    private static void AppendGuides(
        StringBuilder document,
        LayoutReport report,
        IReadOnlyList<RawNode> rawNodes,
        Projection projection,
        CanvasLayout canvas,
        Theme theme)
    {
        switch (projection.Kind)
        {
            case ProjectionKind.Arc:
                AppendArcGuides(document, rawNodes, projection, canvas, theme);
                break;
            default:
                AppendCartesianGuides(document, rawNodes, projection, canvas, theme);
                break;
        }
    }

    private static void AppendArcGuides(
        StringBuilder document,
        IReadOnlyList<RawNode> rawNodes,
        Projection projection,
        CanvasLayout canvas,
        Theme theme)
    {
        var depthGroups = rawNodes
            .Where(node => node.Depth >= 0)
            .GroupBy(node => node.Depth)
            .OrderBy(group => group.Key)
            .ToArray();

        if (depthGroups.Length == 0)
        {
            return;
        }

        document.AppendLine("""  <g id="guides" fill="none">""");
        foreach (var group in depthGroups)
        {
            var averageY = group.Average(node => node.RawY);
            var radius = projection.GetArcRadius(averageY);
            var path = BuildArcGuidePath(projection, radius, canvas);
            var color = theme.GetAccent(group.First().Category, false);
            var labelPoint = projection.ProjectArcLabel(radius);
            var labelCanvas = canvas.Transform(labelPoint);
            document.AppendLine(
                $"""    <path d="{path}" stroke="{color}" stroke-opacity="0.2" stroke-width="1.3" />""");
            document.AppendLine(
                $"""    <text x="{Fmt(labelCanvas.X)}" y="{Fmt(labelCanvas.Y - 6)}" fill="{color}" fill-opacity="0.62" font-family="{theme.FontFamily}" font-size="11" letter-spacing="0.18em">DEPTH {group.Key}</text>""");
        }

        document.AppendLine("  </g>");
    }

    private static void AppendCartesianGuides(
        StringBuilder document,
        IReadOnlyList<RawNode> rawNodes,
        Projection projection,
        CanvasLayout canvas,
        Theme theme)
    {
        var depthGroups = rawNodes
            .Where(node => node.Depth >= 0)
            .GroupBy(node => node.Depth)
            .OrderBy(group => group.Key)
            .ToArray();

        if (depthGroups.Length == 0)
        {
            return;
        }

        document.AppendLine("""  <g id="guides" fill="none">""");
        foreach (var group in depthGroups)
        {
            var averageY = group.Average(node => node.RawY);
            var lineStart = canvas.Transform(projection.Project(new Microsoft.Msagl.Core.Geometry.Point(projection.RawMinX, averageY)));
            var lineEnd = canvas.Transform(projection.Project(new Microsoft.Msagl.Core.Geometry.Point(projection.RawMaxX, averageY)));
            var color = theme.GetAccent(group.First().Category, false);
            document.AppendLine(
                $"""    <line x1="{Fmt(lineStart.X)}" y1="{Fmt(lineStart.Y)}" x2="{Fmt(lineEnd.X)}" y2="{Fmt(lineEnd.Y)}" stroke="{color}" stroke-opacity="0.12" stroke-width="1.1" stroke-dasharray="7 12" />""");
            document.AppendLine(
                $"""    <text x="{Fmt(lineStart.X + 8)}" y="{Fmt(lineStart.Y - 8)}" fill="{color}" fill-opacity="0.52" font-family="{theme.FontFamily}" font-size="11" letter-spacing="0.18em">DEPTH {group.Key}</text>""");
        }

        document.AppendLine("  </g>");
    }

    private static string BuildArcGuidePath(Projection projection, double radius, CanvasLayout canvas)
    {
        var points = Enumerable.Range(0, 40)
            .Select(index =>
            {
                var t = index / 39.0;
                var point = projection.ProjectArcPoint(radius, t);
                return canvas.Transform(point);
            })
            .ToArray();
        return BuildPolylinePath(points);
    }

    private static void AppendHeader(StringBuilder document, LayoutReport report, CanvasLayout canvas, Theme theme)
    {
        var subtitle = $"{report.LayoutMode.ToUpperInvariant()} layout | rich renderer | {report.NodeCount} nodes | {report.EdgeCount} edges";

        document.AppendLine("""  <g id="header">""");
        document.AppendLine(
            $"""    <rect x="22" y="20" width="{Fmt(canvas.Width - 44)}" height="60" rx="22" fill="{theme.HeaderFill}" fill-opacity="0.84" stroke="{theme.HeaderStroke}" stroke-opacity="0.52" />""");
        document.AppendLine(
            $"""    <text x="42" y="46" fill="{theme.HeaderText}" font-family="{theme.FontFamily}" font-size="30" font-weight="700">{Escape(report.GraphTitle)}</text>""");
        document.AppendLine(
            $"""    <text x="42" y="66" fill="{theme.MutedText}" font-family="{theme.FontFamily}" font-size="12" letter-spacing="0.18em">{Escape(subtitle)}</text>""");

        var pills = new[]
        {
            ("GRAPH", report.GraphKey.ToUpperInvariant()),
            ("LAYOUT", report.LayoutMode.ToUpperInvariant()),
            ("RENDER", "RICH"),
        };

        var pillX = canvas.Width - 24;
        for (var i = pills.Length - 1; i >= 0; i--)
        {
            var width = 110.0;
            pillX -= width;
            document.AppendLine(
                $"""    <rect x="{Fmt(pillX)}" y="32" width="{Fmt(width - 10)}" height="24" rx="12" fill="{theme.PillFill}" stroke="{theme.PillStroke}" stroke-opacity="0.46" />""");
            document.AppendLine(
                $"""    <text x="{Fmt(pillX + (width - 10) / 2)}" y="48" text-anchor="middle" fill="{theme.HeaderText}" font-family="{theme.FontFamily}" font-size="11" font-weight="700" letter-spacing="0.14em">{Escape(pills[i].Item2)}</text>""");
            pillX -= 10;
        }

        document.AppendLine("  </g>");
    }

    private static void AppendEdges(
        StringBuilder document,
        Graph graph,
        IReadOnlyDictionary<string, ProjectedNode> projectedLookup,
        Projection projection,
        CanvasLayout canvas,
        Theme theme)
    {
        document.AppendLine("""  <g id="edges" fill="none">""");
        foreach (var edge in graph.Edges)
        {
            if (!projectedLookup.TryGetValue(edge.SourceNode.Id, out var source) ||
                !projectedLookup.TryGetValue(edge.TargetNode.Id, out var target))
            {
                continue;
            }

            var isMuted = source.Role == GraphPartitionNodeRole.Anchor.ToApiValue() || target.Role == GraphPartitionNodeRole.Anchor.ToApiValue();
            var sampledPoints = SampleEdge(edge.EdgeCurve ?? edge.GeometryEdge?.Curve, source, target);
            var canvasPoints = sampledPoints
                .Select(point => canvas.Transform(projection.Project(point)))
                .ToArray();
            if (canvasPoints.Length < 2)
            {
                continue;
            }

            document.AppendLine(
                $"""    <path d="{BuildPolylinePath(canvasPoints)}" stroke="{(isMuted ? "#94A3B8" : theme.EdgeStroke)}" stroke-opacity="{(isMuted ? "0.22" : "0.44")}" stroke-width="{(isMuted ? "1.15" : "1.45")}" stroke-linecap="round" stroke-linejoin="round" marker-end="{(isMuted ? "url(#edge-arrow-muted)" : "url(#edge-arrow)")}" />""");
        }

        document.AppendLine("  </g>");
    }

    private static void AppendNodes(
        StringBuilder document,
        IReadOnlyList<ProjectedNode> projectedNodes,
        CanvasLayout canvas,
        Theme theme)
    {
        document.AppendLine("""  <g id="nodes">""");
        foreach (var node in projectedNodes.OrderBy(node => node.IsEntry ? 1 : 0).ThenBy(node => node.Role == GraphPartitionNodeRole.Anchor.ToApiValue() ? 0 : 1))
        {
            var center = canvas.Transform(node.LocalCenter);
            var labelX = center.X - node.LabelWidth / 2.0;
            var labelY = center.Y + node.Radius + 9;
            var badgeCx = center.X + node.Radius * 0.78;
            var badgeCy = center.Y - node.Radius * 0.78;

            document.AppendLine(
                $"""    <g id="{ToDomId("node", node.Id)}" data-node-id="{Escape(node.Id)}" data-depth="{node.Depth}" data-degree="{node.Degree}" data-category="{Escape(node.Category.ToString().ToLowerInvariant())}" filter="{(node.IsEntry ? "url(#entry-glow)" : "url(#node-soft-glow)")}" >""");

            if (node.IsEntry)
            {
                document.AppendLine(
                    $"""      <circle cx="{Fmt(center.X)}" cy="{Fmt(center.Y)}" r="{Fmt(node.Radius + 7)}" fill="none" stroke="#FDE68A" stroke-width="2.3" stroke-opacity="0.92" />""");
            }

            if (node.Role == GraphPartitionNodeRole.Anchor.ToApiValue())
            {
                var diamond = BuildDiamond(center.X, center.Y, node.Radius + 1.5);
                document.AppendLine(
                    $"""      <path d="{diamond}" fill="{node.Fill}" fill-opacity="0.9" stroke="{node.Stroke}" stroke-width="1.45" />""");
            }
            else
            {
                document.AppendLine(
                    $"""      <circle cx="{Fmt(center.X)}" cy="{Fmt(center.Y)}" r="{Fmt(node.Radius)}" fill="{node.Fill}" fill-opacity="0.92" stroke="{node.Stroke}" stroke-width="{Fmt(node.StrokeWidth)}" />""");
            }

            document.AppendLine(
                $"""      <circle cx="{Fmt(center.X)}" cy="{Fmt(center.Y)}" r="{Fmt(node.Radius - 4.2)}" fill="{node.InnerFill}" fill-opacity="0.94" stroke="{node.InnerStroke}" stroke-opacity="0.5" stroke-width="0.9" />""");
            document.AppendLine(
                $"""      <text x="{Fmt(center.X)}" y="{Fmt(center.Y + 4.2)}" text-anchor="middle" fill="{node.TokenColor}" font-family="{theme.FontFamily}" font-size="{Fmt(node.TokenFontSize)}" font-weight="700" letter-spacing="0.08em">{Escape(node.Token)}</text>""");

            document.AppendLine(
                $"""      <rect x="{Fmt(labelX)}" y="{Fmt(labelY)}" width="{Fmt(node.LabelWidth)}" height="{Fmt(node.LabelHeight)}" rx="{Fmt(node.LabelHeight / 2.3)}" fill="{node.LabelFill}" fill-opacity="0.9" stroke="{node.Stroke}" stroke-opacity="0.34" />""");

            for (var i = 0; i < node.LabelLines.Count; i++)
            {
                document.AppendLine(
                    $"""      <text x="{Fmt(center.X)}" y="{Fmt(labelY + node.LabelPadding + 11 + i * node.LineHeight)}" text-anchor="middle" fill="{node.LabelText}" font-family="{theme.FontFamily}" font-size="{Fmt(node.LabelFontSize)}" font-weight="{(node.IsEntry ? "700" : "600")}">{Escape(node.LabelLines[i])}</text>""");
            }

            if (node.ShowBadge)
            {
                document.AppendLine(
                    $"""      <circle cx="{Fmt(badgeCx)}" cy="{Fmt(badgeCy)}" r="10.5" fill="{theme.BadgeFill}" stroke="{node.Stroke}" stroke-width="1.3" />""");
                document.AppendLine(
                    $"""      <text x="{Fmt(badgeCx)}" y="{Fmt(badgeCy + 3.8)}" text-anchor="middle" fill="{theme.BadgeText}" font-family="{theme.FontFamily}" font-size="10.5" font-weight="700">{node.Degree}</text>""");
            }

            document.AppendLine("    </g>");
        }

        document.AppendLine("  </g>");
    }

    private static void AppendOverlay(StringBuilder document, LayoutReport report, CanvasLayout canvas, Theme theme)
    {
        var note = report.GraphKey.Equals("source-tree", StringComparison.OrdinalIgnoreCase)
            ? "Arc projection over MSAGL coordinates. More map, less paperwork."
            : "Compact glyph rendering over MSAGL coordinates. Still not magic, just less beige.";

        document.AppendLine("""  <g id="overlay">""");
        document.AppendLine(
            $"""    <text x="{Fmt(canvas.Width - 24)}" y="{Fmt(canvas.Height - 22)}" text-anchor="end" fill="{theme.MutedText}" fill-opacity="0.72" font-family="{theme.FontFamily}" font-size="11">{Escape(note)}</text>""");
        document.AppendLine("  </g>");
    }

    private static IReadOnlyList<Microsoft.Msagl.Core.Geometry.Point> SampleEdge(ICurve? curve, ProjectedNode source, ProjectedNode target)
    {
        if (curve is null)
        {
            return
            [
                new Microsoft.Msagl.Core.Geometry.Point(source.RawCenter.X, source.RawCenter.Y),
                new Microsoft.Msagl.Core.Geometry.Point(target.RawCenter.X, target.RawCenter.Y)
            ];
        }

        var sampleCount = Math.Clamp((int)Math.Ceiling(curve.Length / 24.0), 10, 84);
        return Enumerable.Range(0, sampleCount + 1)
            .Select(index => curve[curve.ParStart + ((curve.ParEnd - curve.ParStart) * index / sampleCount)])
            .ToArray();
    }

    private static IReadOnlyDictionary<string, int> CalculateDegrees(Graph graph)
    {
        var degrees = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var node in graph.Nodes)
        {
            degrees[node.Id] = 0;
        }

        foreach (var edge in graph.Edges)
        {
            degrees[edge.SourceNode.Id] = degrees.GetValueOrDefault(edge.SourceNode.Id) + 1;
            degrees[edge.TargetNode.Id] = degrees.GetValueOrDefault(edge.TargetNode.Id) + 1;
        }

        return degrees;
    }

    private static string CreateToken(string title, string role, bool isEntry)
    {
        if (isEntry)
        {
            return "E";
        }

        if (role == GraphPartitionNodeRole.Anchor.ToApiValue())
        {
            return "A";
        }

        var parts = title
            .Split([' ', '/', '-', '_'], StringSplitOptions.RemoveEmptyEntries)
            .Where(part => !StopWords.Contains(part))
            .Select(part => part.Trim())
            .Where(part => part.Length > 0)
            .ToArray();

        if (parts.Length == 0)
        {
            return "N";
        }

        if (parts.Length == 1)
        {
            return parts[0].Length >= 2
                ? parts[0][..2].ToUpperInvariant()
                : parts[0].ToUpperInvariant();
        }

        return $"{char.ToUpperInvariant(parts[0][0])}{char.ToUpperInvariant(parts[1][0])}";
    }

    private static IReadOnlyList<string> WrapLabel(string title, int maxChars, int maxLines)
    {
        if (string.IsNullOrWhiteSpace(title))
        {
            return ["Untitled"];
        }

        var tokens = title.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var lines = new List<string>();
        var current = new StringBuilder();

        foreach (var token in tokens)
        {
            var candidateLength = current.Length == 0 ? token.Length : current.Length + 1 + token.Length;
            if (candidateLength > maxChars && current.Length > 0)
            {
                lines.Add(current.ToString());
                current.Clear();
            }

            if (current.Length > 0)
            {
                current.Append(' ');
            }

            current.Append(token);

            if (lines.Count == maxLines)
            {
                break;
            }
        }

        if (current.Length > 0 && lines.Count < maxLines)
        {
            lines.Add(current.ToString());
        }

        if (lines.Count == 0)
        {
            lines.Add(title);
        }

        if (lines.Count == maxLines && tokens.Length > 0)
        {
            var lastLine = lines[^1];
            if (lastLine.Length > maxChars - 3)
            {
                lines[^1] = $"{lastLine[..Math.Max(1, maxChars - 3)]}...";
            }
        }

        return lines;
    }

    private static string BuildPolylinePath(IReadOnlyList<(double X, double Y)> points)
    {
        if (points.Count == 0)
        {
            return string.Empty;
        }

        var builder = new StringBuilder();
        builder.Append($"M {Fmt(points[0].X)} {Fmt(points[0].Y)}");
        for (var i = 1; i < points.Count; i++)
        {
            builder.Append($" L {Fmt(points[i].X)} {Fmt(points[i].Y)}");
        }

        return builder.ToString();
    }

    private static string BuildDiamond(double centerX, double centerY, double radius) =>
        $"M {Fmt(centerX)} {Fmt(centerY - radius)} L {Fmt(centerX + radius)} {Fmt(centerY)} L {Fmt(centerX)} {Fmt(centerY + radius)} L {Fmt(centerX - radius)} {Fmt(centerY)} Z";

    private static string ToDomId(string prefix, params string[] parts)
    {
        var normalized = string.Join("-", parts)
            .ToLowerInvariant()
            .Select(ch => char.IsLetterOrDigit(ch) ? ch : '-')
            .ToArray();
        var text = new string(normalized);
        while (text.Contains("--", StringComparison.Ordinal))
        {
            text = text.Replace("--", "-", StringComparison.Ordinal);
        }

        return $"{prefix}-{text.Trim('-')}";
    }

    private static string Escape(string value) => WebUtility.HtmlEncode(value);

    private static string Fmt(double value) => value.ToString("0.##", CultureInfo.InvariantCulture);

    private static readonly HashSet<string> StopWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "and",
        "the",
        "of",
        "for",
        "to",
        "a",
        "an",
        "with",
    };

    private sealed record RawNode(
        string Id,
        string Title,
        int Depth,
        string Role,
        bool IsEntry,
        int Degree,
        SemanticCategory Category,
        string Token,
        double RawX,
        double RawY);

    private sealed record ProjectedNode(
        string Id,
        string Title,
        int Depth,
        string Role,
        bool IsEntry,
        int Degree,
        SemanticCategory Category,
        string Token,
        Microsoft.Msagl.Core.Geometry.Point RawCenter,
        (double X, double Y) LocalCenter,
        double Radius,
        double StrokeWidth,
        double TokenFontSize,
        double LabelFontSize,
        double LabelWidth,
        double LabelHeight,
        double LabelPadding,
        double LineHeight,
        bool ShowBadge,
        string Fill,
        string InnerFill,
        string Stroke,
        string InnerStroke,
        string TokenColor,
        string LabelFill,
        string LabelText,
        IReadOnlyList<string> LabelLines)
    {
        public static ProjectedNode Create(RawNode node, Projection projection, Theme theme)
        {
            var localCenter = projection.Project(new Microsoft.Msagl.Core.Geometry.Point(node.RawX, node.RawY));
            var radius = node.IsEntry
                ? 18
                : node.Role == GraphPartitionNodeRole.Anchor.ToApiValue()
                    ? 11.5
                    : Math.Min(16.5, 12.5 + node.Degree * 0.12);
            var labelFontSize = projection.Kind == ProjectionKind.Arc ? 10.6 : 11.3;
            var labelLines = WrapLabel(node.Title, projection.Kind == ProjectionKind.Arc ? 18 : 20, 2);
            var labelPadding = 7.5;
            var lineHeight = labelFontSize + 4.5;
            var labelWidth = Math.Max(
                radius * 2 + 10,
                labelLines.Max(line => line.Length) * labelFontSize * 0.57 + labelPadding * 2);
            var labelHeight = labelLines.Count * lineHeight + labelPadding * 2 - 2;
            var accent = theme.GetAccent(node.Category, node.IsEntry);

            return new ProjectedNode(
                Id: node.Id,
                Title: node.Title,
                Depth: node.Depth,
                Role: node.Role,
                IsEntry: node.IsEntry,
                Degree: node.Degree,
                Category: node.Category,
                Token: node.Token,
                RawCenter: new Microsoft.Msagl.Core.Geometry.Point(node.RawX, node.RawY),
                LocalCenter: localCenter,
                Radius: radius,
                StrokeWidth: node.IsEntry ? 2.2 : node.Role == GraphPartitionNodeRole.Anchor.ToApiValue() ? 1.35 : 1.55,
                TokenFontSize: node.Token.Length > 1 ? 9.2 : 10.6,
                LabelFontSize: labelFontSize,
                LabelWidth: labelWidth,
                LabelHeight: labelHeight,
                LabelPadding: labelPadding,
                LineHeight: lineHeight,
                ShowBadge: node.Degree >= 4 || node.IsEntry,
                Fill: accent,
                InnerFill: theme.NodeInnerFill,
                Stroke: node.IsEntry ? "#FDE68A" : accent,
                InnerStroke: accent,
                TokenColor: node.Role == GraphPartitionNodeRole.Anchor.ToApiValue() ? "#0F172A" : "#F8FAFC",
                LabelFill: theme.LabelFill,
                LabelText: theme.LabelText,
                LabelLines: labelLines);
        }
    }

    private sealed record CanvasLayout(
        double Width,
        double Height,
        double OffsetX,
        double OffsetY)
    {
        public static CanvasLayout Create(IReadOnlyList<ProjectedNode> nodes)
        {
            const double padding = 52;
            const double headerHeight = 94;
            const double footerHeight = 36;

            var minX = nodes.Min(node => Math.Min(node.LocalCenter.X - node.Radius - 12, node.LocalCenter.X - node.LabelWidth / 2.0));
            var maxX = nodes.Max(node => Math.Max(node.LocalCenter.X + node.Radius + 12, node.LocalCenter.X + node.LabelWidth / 2.0));
            var minY = nodes.Min(node => node.LocalCenter.Y - node.Radius - 22);
            var maxY = nodes.Max(node => node.LocalCenter.Y + node.Radius + 12 + node.LabelHeight);

            return new CanvasLayout(
                Width: Math.Max(1280, maxX - minX + padding * 2),
                Height: Math.Max(860, headerHeight + maxY - minY + padding + footerHeight),
                OffsetX: padding - minX,
                OffsetY: headerHeight + padding - minY);
        }

        public (double X, double Y) Transform((double X, double Y) point) =>
            (point.X + OffsetX, point.Y + OffsetY);
    }

    private sealed class Projection
    {
        public ProjectionKind Kind { get; }
        public double RawMinX { get; }
        public double RawMaxX { get; }
        public double RawMinY { get; }
        public double RawMaxY { get; }
        public double ArcStartRadians { get; }
        public double ArcEndRadians { get; }
        public double ArcInnerRadius { get; }
        public double ArcOuterRadius { get; }
        public double CartesianWidth { get; }
        public double CartesianHeight { get; }
        public double CartesianHorizontalScale { get; }

        private Projection(
            ProjectionKind kind,
            double rawMinX,
            double rawMaxX,
            double rawMinY,
            double rawMaxY,
            double arcStartRadians,
            double arcEndRadians,
            double arcInnerRadius,
            double arcOuterRadius,
            double cartesianWidth,
            double cartesianHeight,
            double cartesianHorizontalScale)
        {
            Kind = kind;
            RawMinX = rawMinX;
            RawMaxX = rawMaxX;
            RawMinY = rawMinY;
            RawMaxY = rawMaxY;
            ArcStartRadians = arcStartRadians;
            ArcEndRadians = arcEndRadians;
            ArcInnerRadius = arcInnerRadius;
            ArcOuterRadius = arcOuterRadius;
            CartesianWidth = cartesianWidth;
            CartesianHeight = cartesianHeight;
            CartesianHorizontalScale = cartesianHorizontalScale;
        }

        public static Projection Create(LayoutReport report, IReadOnlyList<RawNode> rawNodes)
        {
            var rawMinX = rawNodes.Min(node => node.RawX);
            var rawMaxX = rawNodes.Max(node => node.RawX);
            var rawMinY = rawNodes.Min(node => node.RawY);
            var rawMaxY = rawNodes.Max(node => node.RawY);
            var distinctDepths = rawNodes.Where(node => node.Depth >= 0).Select(node => node.Depth).Distinct().Count();

            if (report.GraphKey.Equals("source-tree", StringComparison.OrdinalIgnoreCase) &&
                report.LayoutMode.Equals("sugiyama", StringComparison.OrdinalIgnoreCase))
            {
                return new Projection(
                    ProjectionKind.Arc,
                    rawMinX,
                    rawMaxX,
                    rawMinY,
                    rawMaxY,
                    arcStartRadians: DegreesToRadians(162),
                    arcEndRadians: DegreesToRadians(18),
                    arcInnerRadius: 180,
                    arcOuterRadius: Math.Max(430, 210 + distinctDepths * 86),
                    cartesianWidth: 0,
                    cartesianHeight: 0,
                    cartesianHorizontalScale: 1);
            }

            var rawWidth = Math.Max(320, rawMaxX - rawMinX);
            var rawHeight = Math.Max(260, rawMaxY - rawMinY);
            var horizontalScale = report.GraphKey.Equals("control-flow", StringComparison.OrdinalIgnoreCase) ? 1.18 : 0.92;
            var verticalScale = report.GraphKey.Equals("control-flow", StringComparison.OrdinalIgnoreCase) ? 1.22 : 1.04;

            return new Projection(
                ProjectionKind.Cartesian,
                rawMinX,
                rawMaxX,
                rawMinY,
                rawMaxY,
                arcStartRadians: 0,
                arcEndRadians: 0,
                arcInnerRadius: 0,
                arcOuterRadius: 0,
                cartesianWidth: rawWidth * horizontalScale,
                cartesianHeight: rawHeight * verticalScale,
                cartesianHorizontalScale: horizontalScale);
        }

        public (double X, double Y) Project(Microsoft.Msagl.Core.Geometry.Point point)
        {
            var nx = Normalize(point.X, RawMinX, RawMaxX);
            var ny = Normalize(point.Y, RawMinY, RawMaxY);

            return Kind switch
            {
                ProjectionKind.Arc => ProjectArc(nx, 1 - ny),
                _ => ProjectCartesian(nx, ny),
            };
        }

        public double GetArcRadius(double rawY)
        {
            var ny = Normalize(rawY, RawMinY, RawMaxY);
            return ArcInnerRadius + ((1 - ny) * (ArcOuterRadius - ArcInnerRadius));
        }

        public (double X, double Y) ProjectArcPoint(double radius, double t)
        {
            var angle = ArcStartRadians + ((ArcEndRadians - ArcStartRadians) * t);
            return PolarPoint(radius, angle);
        }

        public (double X, double Y) ProjectArcLabel(double radius)
        {
            var angle = ArcStartRadians - DegreesToRadians(7);
            return PolarPoint(radius, angle);
        }

        private (double X, double Y) ProjectArc(double nx, double radialT)
        {
            var angle = ArcStartRadians + ((ArcEndRadians - ArcStartRadians) * nx);
            var radius = ArcInnerRadius + ((ArcOuterRadius - ArcInnerRadius) * radialT);
            return PolarPoint(radius, angle);
        }

        private (double X, double Y) ProjectCartesian(double nx, double ny)
        {
            var centeredX = (nx * 2.0) - 1.0;
            var compressedX = Math.Sign(centeredX) * Math.Pow(Math.Abs(centeredX), 0.88);
            var x = compressedX * (CartesianWidth / 2.0);
            var y = (1 - ny) * CartesianHeight;
            return (x, y);
        }

        private static (double X, double Y) PolarPoint(double radius, double angle) =>
            (Math.Cos(angle) * radius, -Math.Sin(angle) * radius);

        private static double Normalize(double value, double min, double max)
        {
            var range = Math.Max(0.0001, max - min);
            return Math.Clamp((value - min) / range, 0, 1);
        }

        private static double DegreesToRadians(double value) => value * (Math.PI / 180.0);
    }

    private enum ProjectionKind
    {
        Cartesian,
        Arc,
    }

    private enum SemanticCategory
    {
        Root,
        Anchor,
        Shared,
        Client,
        Server,
        Simulation,
        Content,
        Default,
    }

    private static class SemanticCategoryClassifier
    {
        public static SemanticCategory Classify(string graphKey, string title, string role, bool isEntry)
        {
            if (isEntry)
            {
                return SemanticCategory.Root;
            }

            if (role == GraphPartitionNodeRole.Anchor.ToApiValue())
            {
                return SemanticCategory.Anchor;
            }

            if (title.Contains("Shared", StringComparison.OrdinalIgnoreCase))
            {
                return SemanticCategory.Shared;
            }

            if (title.Contains("Server", StringComparison.OrdinalIgnoreCase) ||
                title.Contains("Auth", StringComparison.OrdinalIgnoreCase) ||
                title.Contains("Persistence", StringComparison.OrdinalIgnoreCase) ||
                title.Contains("Serialization", StringComparison.OrdinalIgnoreCase) ||
                title.Contains("Bootstrap", StringComparison.OrdinalIgnoreCase) ||
                title.Contains("Network", StringComparison.OrdinalIgnoreCase))
            {
                return SemanticCategory.Server;
            }

            if (title.Contains("Client", StringComparison.OrdinalIgnoreCase) ||
                title.Contains("UI", StringComparison.OrdinalIgnoreCase) ||
                title.Contains("HUD", StringComparison.OrdinalIgnoreCase) ||
                title.Contains("Menu", StringComparison.OrdinalIgnoreCase) ||
                title.Contains("Input", StringComparison.OrdinalIgnoreCase) ||
                title.Contains("View", StringComparison.OrdinalIgnoreCase) ||
                title.Contains("Weapons", StringComparison.OrdinalIgnoreCase))
            {
                return SemanticCategory.Client;
            }

            if (title.Contains("Simulation", StringComparison.OrdinalIgnoreCase) ||
                title.Contains("Math", StringComparison.OrdinalIgnoreCase) ||
                title.Contains("Zone", StringComparison.OrdinalIgnoreCase) ||
                title.Contains("Galaxy", StringComparison.OrdinalIgnoreCase) ||
                title.Contains("Shader", StringComparison.OrdinalIgnoreCase) ||
                title.Contains("GPU", StringComparison.OrdinalIgnoreCase) ||
                title.Contains("Render", StringComparison.OrdinalIgnoreCase) ||
                title.Contains("Algorithm", StringComparison.OrdinalIgnoreCase))
            {
                return SemanticCategory.Simulation;
            }

            if (title.Contains("Audio", StringComparison.OrdinalIgnoreCase) ||
                title.Contains("Narrative", StringComparison.OrdinalIgnoreCase) ||
                title.Contains("Prefab", StringComparison.OrdinalIgnoreCase) ||
                title.Contains("Asset", StringComparison.OrdinalIgnoreCase) ||
                title.Contains("Corpus", StringComparison.OrdinalIgnoreCase) ||
                title.Contains("Data", StringComparison.OrdinalIgnoreCase) ||
                title.Contains("Authoring", StringComparison.OrdinalIgnoreCase))
            {
                return SemanticCategory.Content;
            }

            return SemanticCategory.Default;
        }
    }

    private sealed record Theme(
        string FontFamily,
        string BackgroundStart,
        string BackgroundMid,
        string BackgroundEnd,
        string HeaderFill,
        string HeaderStroke,
        string HeaderText,
        string MutedText,
        string PillFill,
        string PillStroke,
        string LabelFill,
        string LabelText,
        string NodeInnerFill,
        string EdgeStroke,
        string GlowColor,
        string BadgeFill,
        string BadgeText)
    {
        public static Theme For(string graphKey)
        {
            return graphKey.Equals("control-flow", StringComparison.OrdinalIgnoreCase)
                ? new Theme(
                    FontFamily: "Bahnschrift, Segoe UI, sans-serif",
                    BackgroundStart: "#0C0914",
                    BackgroundMid: "#121424",
                    BackgroundEnd: "#180D12",
                    HeaderFill: "#120E1C",
                    HeaderStroke: "#FB7185",
                    HeaderText: "#FFF7ED",
                    MutedText: "#FDBA74",
                    PillFill: "#221120",
                    PillStroke: "#FB7185",
                    LabelFill: "#151224",
                    LabelText: "#FFF7ED",
                    NodeInnerFill: "#10151F",
                    EdgeStroke: "#FB7185",
                    GlowColor: "#FB7185",
                    BadgeFill: "#140E18",
                    BadgeText: "#FFF7ED")
                : new Theme(
                    FontFamily: "Bahnschrift, Segoe UI, sans-serif",
                    BackgroundStart: "#061019",
                    BackgroundMid: "#0B1424",
                    BackgroundEnd: "#111827",
                    HeaderFill: "#091525",
                    HeaderStroke: "#22D3EE",
                    HeaderText: "#F8FAFC",
                    MutedText: "#A5F3FC",
                    PillFill: "#10263C",
                    PillStroke: "#22D3EE",
                    LabelFill: "#0A1524",
                    LabelText: "#F8FAFC",
                    NodeInnerFill: "#09111D",
                    EdgeStroke: "#22D3EE",
                    GlowColor: "#22D3EE",
                    BadgeFill: "#0B1220",
                    BadgeText: "#F8FAFC");
        }

        public string GetAccent(SemanticCategory category, bool isEntry) =>
            isEntry ? "#FDE68A" : category switch
            {
                SemanticCategory.Root => "#FDE68A",
                SemanticCategory.Anchor => "#94A3B8",
                SemanticCategory.Shared => "#67E8F9",
                SemanticCategory.Client => "#4ADE80",
                SemanticCategory.Server => "#60A5FA",
                SemanticCategory.Simulation => "#C084FC",
                SemanticCategory.Content => "#F472B6",
                _ => "#22D3EE",
            };
    }
}
