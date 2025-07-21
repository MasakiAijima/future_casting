const svg = d3.select("#viz");
const size = 800; // increase overall radius for more spacing between nodes
const datasetSelector = d3.select("#dataset-selector");
const titleElem = d3.select("#dataset-title");
async function init() {
  const datasets = await fetchDatasets();
  Promise.all(datasets.map(p => d3.json(p))).then(ds => {
    ds.forEach((data, i) => {
      datasetSelector.append("option")
        .attr("value", datasets[i])
        .text(data.title || datasets[i]);
    });
    loadAndDraw(datasets[0]);
  });

  datasetSelector.on("change", function() {
    loadAndDraw(this.value);
  });
}

init();

async function fetchDatasets() {
  const files = await d3.json("data/datasets.json");
  return files.map(f => `data/${f}`);
}

function loadAndDraw(path) {
  d3.json(path).then(data => {
    titleElem.text(data.title || path);
    svg.selectAll("*").remove();
    draw(data);
  });
}



// レイヤー構造（外側から内側へ）
//   Signal  -> Scenario -> Paradigm
const layers = ["Signal", "Scenario", "Paradigm"];

// 各レイヤーの中心半径（白とグレーの帯の中央）
// 最内層の Paradigm は円の中心に配置する
const step = (size - 80) / (layers.length - 1);
const ringRadii = layers.map((_, i) => size - i * step);
const layerRadiusByName = {};
layers.forEach((layer, i) => {
  layerRadiusByName[layer] = i === layers.length - 1
    ? 0
    : (ringRadii[i] + ringRadii[i + 1]) / 2;
});

// フォントサイズをレイヤー毎に指定
const fontSizeByLayer = {
  Signal: 12,
  Scenario: 14,
  Paradigm: 16
};

// ノード半径をレイヤー毎に指定（中心に向かうほど大きくする）
const nodeRadiusByLayer = {
  Signal: 12,
  Scenario: 16,
  Paradigm: 20
};

// カテゴリごとの色設定
const categoryColor = d3.scaleOrdinal()
  .domain([
    "Social", "Technology", "Environment", "Economy",
    "Ethics", "Politics", "N/A"
  ])
  .range([
    "#9ED2FF", "#AEEBD8", "#D8F5B0", "#FFD395",
    "#FFF3A0", "#FFCCA2", "#F4A9B8"
  ]);

// データ読み込み

function polarToCartesian(angle, radius) {
  return [
    radius * Math.cos(angle - Math.PI / 2),
    radius * Math.sin(angle - Math.PI / 2)
  ];
}

function draw({ nodes, links }) {
  // 背景の同心円を描画
  const ringG = svg.append("g").attr("class", "rings");
  layers.forEach((layer, i) => {
    ringG.append("circle")
      .attr("r", ringRadii[i])
      .attr("fill", i % 2 === 0 ? "#ffffff" : "#f2f2f2");
  });

  // --- ノード配置計算 ---
  const nodesByLayer = d3.group(nodes, d => d.layer);
  const nodeById = new Map(nodes.map(d => [d.id, d]));

  // Signal レイヤーはデータ順のまま配置
  const signalNodes = nodesByLayer.get("Signal") || [];
  signalNodes.forEach((d, i) => {
    const angle = (2 * Math.PI * i) / signalNodes.length;
    d.angle = angle;
    d.radius = layerRadiusByName[d.layer];
    [d.x, d.y] = polarToCartesian(angle, d.radius);
  });

  // Signal からのリンク情報をグループ化
  const signalLinks = links.filter(l => nodeById.get(l.source)?.layer === "Signal");
  const signalLinksByTarget = d3.group(signalLinks, l => l.target);

  // 指定レイヤーのノードを、リンク元ノードの平均角度順に並べる
  function positionLayer(layer, inboundLinksByTarget) {
    const layerNodes = nodesByLayer.get(layer) || [];
    layerNodes.forEach(d => {
      const linksToNode = inboundLinksByTarget.get(d.id) || [];
      const angles = linksToNode.map(l => nodeById.get(l.source).angle);
      d.sortAngle = angles.length ? d3.mean(angles) : null;
    });
    layerNodes.sort((a, b) => {
      const aa = a.sortAngle ?? Infinity;
      const bb = b.sortAngle ?? Infinity;
      return aa - bb;
    });
    layerNodes.forEach((d, i) => {
      const angle = (2 * Math.PI * i) / layerNodes.length;
      d.angle = angle;
      d.radius = layerRadiusByName[d.layer];
      [d.x, d.y] = polarToCartesian(angle, d.radius);
    });
  }

  // Scenario レイヤーを並べ替え
  positionLayer("Scenario", signalLinksByTarget);

  // Paradigm レイヤー (中心) のノードを配置
  const paradigmNodes = nodesByLayer.get("Paradigm") || [];
  paradigmNodes.forEach(d => {
    d.angle = 0;
    d.radius = layerRadiusByName[d.layer];
    [d.x, d.y] = polarToCartesian(0, d.radius);
  });

  // リンク描画
  const linkGen = d3.linkRadial()
    .angle(d => d.angle)
    .radius(d => d.radius);

  const filteredLinks = links.map(l => ({
      source: nodes.find(n => n.id === l.source),
      target: nodes.find(n => n.id === l.target)
    }))
    .filter(l => l.source && l.target);

  svg.append("g")
    .attr("class", "links")
    .selectAll("path")
    .data(filteredLinks)
    .enter().append("path")
    .attr("d", linkGen)
    .attr("class", "link")
    .attr("fill", "none")
    .attr("stroke", "#999")
    .attr("stroke-width", 2)
    .attr("opacity", 0.4);

  // ノード描画
  const defs = svg.append("defs");
  const nodeG = svg.append("g")
    .attr("class", "nodes")
    .selectAll("g")
    .data(nodes)
    .enter().append("g")
    .attr("transform", d => `translate(${d.x},${d.y})`)
    .attr("class", d => `node ${d.layer.toLowerCase()}`)
    .on("mouseover", highlight)
    .on("mouseout", clearHighlight)
    .on("click", toggleDescription);

  nodeG.each(function(d) {
    if (d.image_url) {
      defs.append("clipPath")
        .attr("id", `clip-${d.id}`)
        .append("circle")
        .attr("r", nodeRadiusByLayer[d.layer]);
    }
  });

  // ノードの丸
  nodeG.append("circle")
    .attr("class", "node-circle")
    .attr("r", d => nodeRadiusByLayer[d.layer])
    .attr("fill", d => categoryColor(d.category))
    .attr("stroke", "#fff")
    .attr("stroke-width", 1.5);

  // ノードの画像
  nodeG.filter(d => d.image_url)
    .append("image")
    .attr("class", "node-image")
    .attr("href", d => d.image_url)
    .attr("width", d => nodeRadiusByLayer[d.layer] * 2)
    .attr("height", d => nodeRadiusByLayer[d.layer] * 2)
    .attr("x", d => -nodeRadiusByLayer[d.layer])
    .attr("y", d => -nodeRadiusByLayer[d.layer])
    .attr("clip-path", d => `url(#clip-${d.id})`)
    .style("display", "none");

  // ノードのテキスト（常に横書き）
  nodeG.append("text")
    .text(d => d.display_name)
    .attr("dy", "-0.8em")
    .attr("text-anchor", "middle")
    .attr("fill", "#999")
    .style("font-size", d => `${fontSizeByLayer[d.layer]}px`)
    .style("pointer-events", "none");

  // 説明用背景（初期は非表示）
  nodeG.append("rect")
    .attr("class", "description-bg")
    .attr("rx", 4)
    .attr("ry", 4)
    .style("display", "none");

  // 説明文（初期は非表示）
  nodeG.append("text")
    .attr("class", "description")
    .text(d => {
      const prob = d.probability ?? 0;
      const time = d.timeline ?? 0;
      return `${d.description} (p: ${prob}, t: ${time})`;
    })
    .attr("dy", "1.2em")
    .attr("text-anchor", "middle")
    .attr("fill", "#333")
    .style("font-size", d => `${fontSizeByLayer[d.layer]}px`)
    .style("display", "none")
    .style("pointer-events", "none");

  // 凡例
  const legend = svg.append("g")
    .attr("class", "legend")
    .attr("transform", `translate(${size + 60},${-size})`);

  categoryColor.domain().forEach((cat, i) => {
    const g = legend.append("g").attr("transform", `translate(0, ${i * 24})`);
    g.append("circle")
      .attr("r", 8)
      .attr("fill", categoryColor(cat));
    g.append("text")
      .attr("x", 16)
      .attr("dy", "0.35em")
      .text(cat)
      .style("font-size", "12px");
  });
}

// ノード hover で強調
function highlight(event, d) {
  svg.selectAll(".link").classed("highlight", l =>
    l.source.id === d.id || l.target.id === d.id
  ).attr("stroke-opacity", l =>
    l.source.id === d.id || l.target.id === d.id ? 0.9 : 0.2
  );

  d3.select(this).classed("highlight", true);
  d3.select(this).select("text").attr("fill", "#000");
}

// hover 解除
function clearHighlight() {
  svg.selectAll(".highlight").classed("highlight", false)
    .attr("stroke-opacity", 0.4);
  svg.selectAll(".node text:not(.description)").attr("fill", "#999");
}

// ノードクリックで説明文の表示/非表示を切り替え
function toggleDescription(event, d) {
  const g = d3.select(this);
  // bring clicked element to front so it appears above others
  g.raise();
  const circle = g.select("circle.node-circle");
  const label = g.select("text:not(.description)");
  const desc = g.select("text.description");
  const bg = g.select("rect.description-bg");
  const image = g.select("image.node-image");
  const clipCircle = d3.select(`#clip-${d.id} circle`);

  const expanded = circle.classed("expanded");
  const baseR = nodeRadiusByLayer[d.layer];
  const newR = expanded ? baseR : baseR * 10;

  circle.classed("expanded", !expanded)
    .transition()
    .attr("r", newR);

  if (clipCircle.node()) {
    clipCircle.transition().attr("r", newR);
  }

  if (image.node()) {
    if (!expanded) image.style("display", "block");
    image.transition()
      .attr("width", newR * 2)
      .attr("height", newR * 2)
      .attr("x", -newR)
      .attr("y", -newR)
      .on("end", () => {
        if (expanded) image.style("display", "none");
      });
  }

  label.style("display", "block");

  if (!expanded) {
    desc.style("display", "block");
    const width = newR * 1.2; // narrower wrap width for descriptions
    wrapText(desc, width);
    const bbox = desc.node().getBBox();
    bg.attr("width", bbox.width + 8)
      .attr("height", bbox.height + 4)
      .attr("x", bbox.x - 4)
      .attr("y", bbox.y - 2)
      .style("display", "block");
  } else {
    desc.style("display", "none");
    bg.style("display", "none");
  }
}

// テキストを指定幅で折り返す
function wrapText(textSelection, width) {
  textSelection.each(function() {
    const text = d3.select(this);
    const words = text.text().split(/\s+/).reverse();
    let word;
    let line = [];
    let lineNumber = 0;
    const lineHeight = 1.1; // ems
    const y = text.attr("y") || 0;
    const dy = parseFloat(text.attr("dy")) || 0;
    let tspan = text.text(null)
      .append("tspan")
      .attr("x", 0)
      .attr("y", y)
      .attr("dy", dy + "em");

    while (word = words.pop()) {
      line.push(word);
      tspan.text(line.join(" "));
      if (tspan.node().getComputedTextLength() > width) {
        line.pop();
        tspan.text(line.join(" "));
        line = [word];
        tspan = text.append("tspan")
          .attr("x", 0)
          .attr("y", y)
          .attr("dy", ++lineNumber * lineHeight + dy + "em")
          .text(word);
      }
    }
  });
}
