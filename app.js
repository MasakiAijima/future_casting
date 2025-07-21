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
const layers = ["Micro", "Affordance", "Impact", "Goal"];

// 各レイヤーの中心半径（白とグレーの帯の中央）
// 最内層の Goal は円の中心に配置する
const step = (size - 80) / (layers.length - 1);
const ringRadii = layers.map((_, i) => size - i * step);
const layerRadiusByName = {
  Micro: (ringRadii[0] + ringRadii[1]) / 2,
  Affordance: (ringRadii[1] + ringRadii[2]) / 2,
  Impact: (ringRadii[2] + ringRadii[3]) / 2,
  Goal: 0
};

// フォントサイズをレイヤー毎に指定
const fontSizeByLayer = {
  Micro: 12,
  Affordance: 14,
  Impact: 16,
  Goal: 18
};

// ノード半径をレイヤー毎に指定（中心に向かうほど大きくする）
const nodeRadiusByLayer = {
  Micro: 12,          // 現在の4倍の面積 -> 半径2倍
  Affordance: 16,
  Impact: 20,
  Goal: 24
};

// カテゴリごとの色設定
const categoryColor = d3.scaleOrdinal()
  .domain([
    "Natural", "Financial", "Manufactured", "Digital",
    "Human", "Social", "Political", "Cultural"
  ])
  .range([
    "#9ED2FF", "#AEEBD8", "#D8F5B0", "#FFD395",
    "#FFF3A0", "#FFCCA2", "#F4A9B8", "#D8C8FF"
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

  // Micro レイヤーはデータ順のまま配置
  const microNodes = nodesByLayer.get("Micro") || [];
  microNodes.forEach((d, i) => {
    const angle = (2 * Math.PI * i) / microNodes.length;
    d.angle = angle;
    d.radius = layerRadiusByName[d.layer];
    [d.x, d.y] = polarToCartesian(angle, d.radius);
  });

  // Micro からのリンク情報をグループ化
  const microLinks = links.filter(l => nodeById.get(l.source)?.layer === "Micro");
  const microLinksByTarget = d3.group(microLinks, l => l.target);

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

  // Affordance レイヤーを並べ替え
  positionLayer("Affordance", microLinksByTarget);

  // Affordance から Impact へのリンクを使って Impact を並べ替え
  const affLinks = links.filter(l => nodeById.get(l.source)?.layer === "Affordance");
  const affLinksByTarget = d3.group(affLinks, l => l.target);
  positionLayer("Impact", affLinksByTarget);

  // Goal レイヤー (中心) のノードを配置
  const goalNodes = nodesByLayer.get("Goal") || [];
  goalNodes.forEach(d => {
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
  const nodeG = svg.append("g")
    .attr("class", "nodes")
    .selectAll("g")
    .data(nodes)
    .enter().append("g")
    .attr("transform", d => `translate(${d.x},${d.y})`)
    .attr("class", d => `node ${d.layer.toLowerCase()}`)
    .on("mouseover", highlight)
    .on("mouseout", clearHighlight);

  // ノードの丸
  nodeG.append("circle")
    .attr("r", d => nodeRadiusByLayer[d.layer])
    .attr("fill", d => categoryColor(d.category))
    .attr("stroke", "#fff")
    .attr("stroke-width", 1.5);

  // ノードのテキスト（常に横書き）
  nodeG.append("text")
    .text(d => d.display_name)
    .attr("dy", "-0.8em")
    .attr("text-anchor", "middle")
    .attr("fill", "#999")
    .style("font-size", d => `${fontSizeByLayer[d.layer]}px`)
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
  svg.selectAll(".node text").attr("fill", "#999");
}
