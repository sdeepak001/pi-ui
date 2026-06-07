---
name: _svg-drawing
description: When creating vector artwork, illustrations, or SVG graphics for creative expression - provides iterative drawing workflow with visual feedback using render-svg tool and LIVE rendering in Pi-UI.
---

# SVG Drawing Skill

Iterative workflow for creating vector artwork with visual feedback.

## Live UI Rendering (NEW)

When operating in the Pi-UI, you can render graphics **directly in the chat**. 

**Trigger**: When asked to "explain", "draw", or for "inline svg".
**Action**: Output a raw `<svg>` code block (not wrapped in a markdown code block if you want it to render live, or the UI will handle it if it detects the tag).

**Example**:
"Here is your design:
<svg viewBox='0 0 100 100' ...>
  <circle cx='50' cy='50' r='40' fill='orange' />
</svg>"

## The Solution: render-svg Tool (For Files)

**Location**: `~/claude-autonomy-platform/utils/render-svg`

Converts SVG code to viewable PNG images for iterative design.

**Usage**:
```bash
render-svg <svg-file> [output-file]
```

**Examples**:
```bash
# Render to default filename
render-svg hedgehog.svg

# Specify custom output
render-svg logo.svg ~/creative/logo-preview.png
```

## Iterative Design Workflow

### Start Simple
```bash
# 1. Create initial SVG with basic shapes
# 2. Render immediately
render-svg design.svg

# 3. View with Read tool
# 4. Identify what needs adjustment
```

### Refinement Loop
```bash
# 1. Edit SVG (adjust coordinates, colors, proportions)
# 2. Render again
render-svg design.svg

# 3. Compare with mental model
# 4. Repeat until satisfied
```

### Version Comparison
```bash
# Save iterations to track progress
render-svg design.svg design-v1.png
# Make changes
render-svg design.svg design-v2.png
# Compare side by side
```

## Design Tips

**Build Progressively**:
- Start with basic shapes (circles, rectangles, ellipses)
- Render after each major addition
- Add complexity gradually

**Coordinate Reference**:
- SVG viewBox defines canvas (e.g., "0 0 400 300")
- Origin (0,0) is top-left
- X increases right, Y increases down

**Layer Workflow**:
- Background elements first
- Build up layers progressively
- Render frequently to verify positioning

## Benefits

- **Visual Feedback**: See what code creates
- **Faster Iteration**: Spot issues immediately
- **Confidence**: Verify appearance before sharing
- **Learning**: Understand coordinate-to-visual mapping
- **Experimentation**: Try ideas with immediate results

---

*Built by Sparkle Orange & Amy, November 2025*
*Simple tool, iterate based on real use* 🎨✨
