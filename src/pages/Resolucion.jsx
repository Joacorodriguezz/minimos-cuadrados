import React, { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import Plot from "react-plotly.js";
import { Button, ButtonGroup } from "react-bootstrap";
import { useMemo } from "react";

const Resolucion = () => {
  const [data, setData] = useState([]);
  const [fitType, setFitType] = useState("exponencial");
  const [useClusters, setUseClusters] = useState(false);
  const [clusterType, setClusterType] = useState("clima");
  const [graphType, setGraphType] = useState("potencia");
  const [results, setResults] = useState(null);
  const [bestFit, setBestFit] = useState(null);


  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (data.length > 0) calculateRegression();
  }, [data, fitType, useClusters, clusterType, graphType]);

  const loadData = async () => {
    try {
      const response = await fetch("/data2.xlsx");
      const arrayBuffer = await response.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      const parsed = jsonData
        .map((row) => {
          // Parsear irradiancia (coma como decimal)
          const irradiance = parseFloat(
            String(row.irradiance_Wm2 || row["irradiance_Wm2"]).replace(",", ".")
          );
          
          // Parsear potencia (kW, eliminar comas de miles)
          const power = parseFloat(
            String(row.pv_power_kW || row["pv_power_kW"]).replace(/,/g, ".")
          );
          
          // Parsear generación (W, eliminar comas de miles, convertir a kW)
          const generacionW = parseFloat(
            String(row.generacion_W || row["generacion_W"]).replace(/,/g, "")
          );
          const generacionKW = generacionW / 1000;
          
          return {
            irradiance,
            power,
            generacionKW,
            skyState: row.sky_state || row["sky_state"],
            inclinacion: parseFloat(
              String(row["inclinacion"] || row.inclinacion_).replace(",", ".")
            ),
            temperatura: parseFloat(
              String(row["temperatura_ambiental"] || row.temperatura_ambiental_C).replace(",", ".")
            ),
          };
        })
        // Filtro: si alguna columna importante está en 0 o es NaN, no se carga
        .filter((d) => 
          !isNaN(d.irradiance) && !isNaN(d.power) && !isNaN(d.generacionKW) &&
          d.irradiance !== 0 && d.power !== 0 && d.generacionKW !== 0
        );
      
      console.log("Loaded data:", parsed);
      setData(parsed);
    } catch (error) {
      console.error("Error loading data:", error);
    }
  };

  const generateClimaClusters = () => {
    // Clustering por clima (nublado/despejado)
    const clusters = {};

    data.forEach((point) => {
      const clusterKey = point.skyState;

      if (!clusters[clusterKey]) {
        clusters[clusterKey] = {
          key: clusterKey,
          label: point.skyState === "cloudy" ? "Nublado" : "Despejado",
          data: [],
        };
      }

      clusters[clusterKey].data.push(point);
    });

    return Object.values(clusters).filter((c) => c.data.length > 0);
  };

  const generateTemperaturaClusters = () => {
    // Clustering por temperatura: fría (<=10), media (11-29), cálida (>=30)
    const clusters = {
      fria: { key: "fria", label: "Fría (≤10°C)", data: [] },
      media: { key: "media", label: "Media (11-29°C)", data: [] },
      calida: { key: "calida", label: "Cálida (≥30°C)", data: [] },
    };

    data.forEach((point) => {
      if (point.temperatura <= 10) {
        clusters.fria.data.push(point);
      } else if (point.temperatura <= 29) {
        clusters.media.data.push(point);
      } else {
        clusters.calida.data.push(point);
      }
    });

    return Object.values(clusters).filter((c) => c.data.length > 0);
  };

  const generateInclinacionClusters = () => {
    // Clustering por inclinación: baja (<=30), alta (>30)
    const clusters = {
      baja: { key: "baja", label: "Baja (≤30°)", data: [] },
      alta: { key: "alta", label: "Alta (>30°)", data: [] },
    };

    data.forEach((point) => {
      if (point.inclinacion <= 30) {
        clusters.baja.data.push(point);
      } else {
        clusters.alta.data.push(point);
      }
    });

    return Object.values(clusters).filter((c) => c.data.length > 0);
  };

  const generateClusters = () => {
    if (clusterType === "clima") {
      return generateClimaClusters();
    } else if (clusterType === "temperatura") {
      return generateTemperaturaClusters();
    } else if (clusterType === "inclinacion") {
      return generateInclinacionClusters();
    }
    return [];
  };

  const calculateRegression = () => {
    if (!useClusters) {
      const result = performRegression(data, fitType);
      setResults({ overall: result });
    } else {
      const clusters = generateClusters();
      const clusterResults = {};
      
      // Calcular RMSE global combinando todos los clusters
      let allPredictions = [];
      let allActuals = [];

      clusters.forEach((cluster) => {
        const result = performRegression(cluster.data, fitType);
        clusterResults[cluster.key] = { ...result, cluster };
        
        // Acumular predicciones y valores reales
        const x = cluster.data.map((d) => d.irradiance);
        const y = cluster.data.map((d) => d.power);
        const predictions = x.map((xi) => {
          // Recrear la función de predicción basada en los coeficientes
          if (fitType === "lineal") {
            return result.coefficients[0] * xi + result.coefficients[1];
          } else if (fitType === "exponencial") {
            return result.coefficients[0] * Math.exp(result.coefficients[1] * xi);
          } else if (fitType === "potencial") {
            return result.coefficients[0] * Math.pow(xi, result.coefficients[1]);
          } else if (fitType === "polinomico") {
            return result.coefficients[0] + result.coefficients[1] * xi + result.coefficients[2] * xi * xi;
          }
        });
        
        allPredictions = allPredictions.concat(predictions);
        allActuals = allActuals.concat(y);
      });

      const globalRMSE = calculateRMSE(allActuals, allPredictions);
      // Obtener los labels del primer cluster para usarlos en el gráfico
      const firstCluster = Object.values(clusterResults)[0];
      setResults({ 
        clusters: clusterResults, 
        globalRMSE: globalRMSE,
        xLabel: firstCluster?.xLabel,
        yLabel: firstCluster?.yLabel,
      });
    }
  };

  const calculateRMSEForClusterType = (clusterType, modelType) => {
    const clusters = (() => {
      if (clusterType === "clima") {
        return generateClimaClusters();
      } else if (clusterType === "temperatura") {
        return generateTemperaturaClusters();
      } else if (clusterType === "inclinacion") {
        return generateInclinacionClusters();
      }
      return [];
    })();

    let allPredictions = [];
    let allActuals = [];

    clusters.forEach((cluster) => {
      const result = performRegression(cluster.data, modelType);
      const x = cluster.data.map((d) => d.irradiance);
      const y = cluster.data.map((d) => d.power);
      const predictions = x.map((xi) => {
        if (modelType === "lineal") {
          return result.coefficients[0] * xi + result.coefficients[1];
        } else if (modelType === "exponencial") {
          return result.coefficients[0] * Math.exp(result.coefficients[1] * xi);
        } else if (modelType === "potencial") {
          return result.coefficients[0] * Math.pow(xi, result.coefficients[1]);
        } else if (modelType === "polinomico") {
          return result.coefficients[0] + result.coefficients[1] * xi + result.coefficients[2] * xi * xi;
        }
      });
      
      allPredictions = allPredictions.concat(predictions);
      allActuals = allActuals.concat(y);
    });

    return calculateRMSE(allActuals, allPredictions);
  };

  const findBestRegression = () => {
    // Calcular R² ajustado para cada modelo SIN clusters
    const r2Map = {
      lineal: performRegression(data, "lineal")?.adjustedR2 ?? 0,
      exponencial: performRegression(data, "exponencial")?.adjustedR2 ?? 0,
      potencial: performRegression(data, "potencial")?.adjustedR2 ?? 0,
      polinomico: performRegression(data, "polinomico")?.adjustedR2 ?? 0,
    };

    // Crear tabla de comparación
    const comparisonTable = Object.entries(r2Map).map(([type, r2]) => ({
      type,
      adjustedR2: r2,
      params: type === "polinomico" ? 3 : 2,
    }));

    // Encontrar el mejor modelo sin clusters
    // En caso de empate, elige el con menos variables (no polinómico)
    let bestType = "lineal";
    let bestR2 = r2Map.lineal;

    for (const [type, r2] of Object.entries(r2Map)) {
      if (r2 > bestR2) {
        bestR2 = r2;
        bestType = type;
      } else if (r2 === bestR2 && type !== "polinomico" && bestType === "polinomico") {
        // Si hay empate y el actual no es polinómico pero el mejor sí, cambiar
        bestType = type;
      }
    }

    // Calcular RMSE sin clusters
    const resultWithoutClusters = performRegression(data, bestType);
    const rmseWithoutClusters = resultWithoutClusters.rmse;

    // Calcular RMSE para cada tipo de clustering
    const rmseClimaWithClusters = calculateRMSEForClusterType("clima", bestType);
    const rmseTemperaturaWithClusters = calculateRMSEForClusterType("temperatura", bestType);
    const rmseInclinacionWithClusters = calculateRMSEForClusterType("inclinacion", bestType);

    // Tabla de comparación de RMSE
    const rmseComparisonTable = [
      {
        type: "Sin clusters",
        rmse: rmseWithoutClusters,
        proportion: 1.0,
      },
      {
        type: "Clima",
        rmse: rmseClimaWithClusters,
        proportion: rmseClimaWithClusters / rmseWithoutClusters,
      },
      {
        type: "Temperatura",
        rmse: rmseTemperaturaWithClusters,
        proportion: rmseTemperaturaWithClusters / rmseWithoutClusters,
      },
      {
        type: "Inclinación",
        rmse: rmseInclinacionWithClusters,
        proportion: rmseInclinacionWithClusters / rmseWithoutClusters,
      },
    ];

    // Encontrar el mejor: si proporción está entre 0.9 y 1.1, gana sin clusters
    let bestConfiguration = rmseComparisonTable[0];
    for (let i = 1; i < rmseComparisonTable.length; i++) {
      const current = rmseComparisonTable[i];
      const proportion = current.proportion;
      
      if (proportion >= 0.9 && proportion <= 1.1) {
        // Proporción dentro del rango, sin clusters gana
        continue;
      } else if (current.rmse < bestConfiguration.rmse) {
        // Fuera del rango, el con menor RMSE gana
        bestConfiguration = current;
      }
    }

    setBestFit({
      type: bestType,
      adjustedR2: resultWithoutClusters.adjustedR2,
      coefficients: resultWithoutClusters.coefficients,
      rmseWithoutClusters: rmseWithoutClusters,
      rmseComparisonTable: rmseComparisonTable,
      bestConfiguration: bestConfiguration,
      comparisonTable: comparisonTable,
    });
  };


  const performRegression = (dataset, type) => {
    const n = dataset.length;
    if (n === 0) return null;

    // Seleccionar datos según el tipo de gráfico
    let x, y, xLabel, yLabel;
    
    if (graphType === "potencia") {
      x = dataset.map((d) => d.irradiance);
      y = dataset.map((d) => d.power);
      xLabel = "Irradiancia (W/m²)";
      yLabel = "Potencia (kW)";
    } else if (graphType === "generacion") {
      x = dataset.map((d) => d.power);
      y = dataset.map((d) => d.generacionKW);
      xLabel = "Potencia (kW)";
      yLabel = "Generación (kW)";
    }

    let coeffs = [];
    let predictFunc = null;
    let numParams = 0;

    if (type === "lineal") {
      const result = linearRegression(x, y);
      coeffs = [result.a, result.b];
      predictFunc = (xi) => result.a * xi + result.b;
      numParams = 2;
    } else if (type === "exponencial") {
      const result = exponentialRegression(x, y);
      coeffs = [result.a, result.b];
      predictFunc = (xi) => result.a * Math.exp(result.b * xi);
      numParams = 2;
    } else if (type === "potencial") {
      const result = powerRegression(x, y);
      coeffs = [result.a, result.b];
      predictFunc = (xi) => result.a * Math.pow(xi, result.b);
      numParams = 2;
    } else if (type === "polinomico") {
      const result = polynomialRegression(x, y, 2);
      coeffs = result;
      predictFunc = (xi) => result[0] + result[1] * xi + result[2] * xi * xi;
      numParams = 3;
    }

    // Mantener la regresión entrenada con todos los puntos del dataset
    const predictions = x.map(predictFunc);

    // Para el cálculo de R² (y R² ajustado) sólo usamos puntos donde la potencia > 40
    const filteredForR2 = dataset.filter((d) => d.power > 40);
    let rSquared = 0;
    let nForAdjusted = n; // por defecto usamos el tamaño total
    if (filteredForR2.length > 0) {
      const xForR2 = filteredForR2.map((d) => (graphType === "potencia" ? d.irradiance : d.power));
      const yForR2 = filteredForR2.map((d) => (graphType === "potencia" ? d.power : d.generacionKW));
      const predsForR2 = xForR2.map(predictFunc);
      rSquared = calculateR2(yForR2, predsForR2);
      nForAdjusted = yForR2.length;
    }
    const rmse = calculateRMSE(y, predictions);
    const adjustedR2 = isNaN(rSquared) || nForAdjusted <= numParams + 1
      ? 0
      : 1 - ((1 - rSquared) * (nForAdjusted - 1)) / (nForAdjusted - numParams - 1);

    const minX = Math.min(...x);
    const maxX = Math.max(...x);
    const curvePoints = [];
    for (let i = 0; i <= 100; i++) {
      const xi = minX + ((maxX - minX) * i) / 100;
      curvePoints.push({ x: xi, y: predictFunc(xi) });
    }

    return {
      coefficients: coeffs,
      r2: rSquared,
      adjustedR2: adjustedR2,
      rmse: rmse,
      curvePoints: curvePoints,
      scatterData: dataset.map((d) => ({
        x: graphType === "potencia" ? d.irradiance : d.power,
        y: graphType === "potencia" ? d.power : d.generacionKW,
        skyState: d.skyState,
      })),
      xLabel: xLabel,
      yLabel: yLabel,
    };
  };

  const linearRegression = (x, y) => {
    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);

    const a = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const b = (sumY - a * sumX) / n;
    return { a, b };
  };

  const exponentialRegression = (x, y) => {
    const filtered = x.map((xi, i) => ({ xi, yi: y[i] })).filter(p => p.yi > 0);
    if (filtered.length < 3) return { a: 1, b: 0 }; 

    const lnY = filtered.map((p) => Math.log(p.yi));
    const xVals = filtered.map((p) => p.xi);
    const result = linearRegression(xVals, lnY);

    return { a: Math.exp(result.b), b: result.a };
  };


  const powerRegression = (x, y) => {
    const lnX = x.map((xi) => Math.log(Math.max(xi, 0.001)));
    const lnY = y.map((yi) => Math.log(Math.max(yi, 0.001)));
    const result = linearRegression(lnX, lnY);
    return { a: Math.exp(result.b), b: result.a };
  };

  const polynomialRegression = (x, y, degree) => {
    const n = x.length;
    const matrix = [];
    const vector = [];

    for (let i = 0; i <= degree; i++) {
      const row = [];
      for (let j = 0; j <= degree; j++) {
        let sum = 0;
        for (let k = 0; k < n; k++) sum += Math.pow(x[k], i + j);
        row.push(sum);
      }
      matrix.push(row);
      let sum = 0;
      for (let k = 0; k < n; k++) sum += y[k] * Math.pow(x[k], i);
      vector.push(sum);
    }

    return gaussianElimination(matrix, vector);
  };

  const gaussianElimination = (A, b) => {
    const n = b.length;
    const Ab = A.map((row, i) => [...row, b[i]]);
    for (let i = 0; i < n; i++) {
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(Ab[k][i]) > Math.abs(Ab[maxRow][i])) maxRow = k;
      }
      [Ab[i], Ab[maxRow]] = [Ab[maxRow], Ab[i]];
      for (let k = i + 1; k < n; k++) {
        const factor = Ab[k][i] / Ab[i][i];
        for (let j = i; j <= n; j++) Ab[k][j] -= factor * Ab[i][j];
      }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
      x[i] = Ab[i][n];
      for (let j = i + 1; j < n; j++) x[i] -= Ab[i][j] * x[j];
      x[i] /= Ab[i][i];
    }
    return x;
  };

  const calculateR2 = (actual, predicted) => {
    if (actual.length === 0) return 0;
    const mean = actual.reduce((a, b) => a + b, 0) / actual.length;
    const ssTotal = actual.reduce((sum, yi) => sum + Math.pow(yi - mean, 2), 0);
    const ssResidual = actual.reduce(
      (sum, yi, i) => sum + Math.pow(yi - predicted[i], 2),
      0
    );
    return ssTotal === 0 ? 0 : 1 - ssResidual / ssTotal;
  };

  const calculateRMSE = (actual, predicted) => {
    if (actual.length === 0) return 0;
    const squaredErrors = actual.map((yi, i) => Math.pow(yi - predicted[i], 2));
    const mse = squaredErrors.reduce((a, b) => a + b, 0) / actual.length;
    return Math.sqrt(mse);
  };

  const formatR2 = (r2) => r2.toFixed(4);

  const getR2Color = (r2) => {
    // Colorea de rojo (malo) a verde (bueno) según el valor de R²
    const red = Math.round(255 * (1 - r2 + 0.5));
    const green = Math.round(255 * r2);
    return { backgroundColor: `rgb(${red},${green},0)` };
  };

  const getPlotData = () => {
    if (!results) return [];

    if (useClusters && results.clusters) {
      const traces = [];
      const colors = [
        "red",
        "blue",
        "green",
        "orange",
        "purple",
        "cyan",
        "magenta",
        "yellow",
      ];
      let colorIndex = 0;

      Object.values(results.clusters).forEach((clusterResult) => {
        const color = colors[colorIndex % colors.length];
        const clusterLabel = clusterResult.cluster.label;

        // Scatter plot para el cluster (excluir puntos con potencia < 40)
        // Nota: cuando graphType === 'potencia', la potencia está en p.y.
        //       cuando graphType === 'generacion', la potencia está en p.x.
        const filteredClusterPoints = clusterResult.scatterData.filter((p) => {
          const powerValue = graphType === "potencia" ? p.y : p.x;
          return powerValue >= 40;
        });

        traces.push({
          x: filteredClusterPoints.map((p) => p.x),
          y: filteredClusterPoints.map((p) => p.y),
          mode: "markers",
          name: clusterLabel,
          marker: { color: color, size: 4, opacity: 0.6 },
          type: "scattergl",
        });

        // Línea de ajuste para el cluster
        traces.push({
          x: clusterResult.curvePoints.map((p) => p.x),
          y: clusterResult.curvePoints.map((p) => p.y),
          mode: "lines",
          name: `Ajuste: ${clusterLabel}`,
          line: { color: color, width: 2 },
          showlegend: false,
        });

        colorIndex++;
      });

      return traces;
    } else {
      if (!results?.overall?.scatterData) return [];
      const filteredOverallPoints = results.overall.scatterData.filter((p) => {
        const powerValue = graphType === "potencia" ? p.y : p.x;
        return powerValue >= 40;
      });

      return [
        {
          x: filteredOverallPoints.map((p) => p.x),
          y: filteredOverallPoints.map((p) => p.y),
          mode: "markers",
          name: "Datos",
          marker: { color: "#FFA500", size: 4, opacity: 0.6 },
          type: "scattergl",
        },
        {
          x: results.overall.curvePoints.map((p) => p.x),
          y: results.overall.curvePoints.map((p) => p.y),
          mode: "lines",
          name: "Ajuste",
          line: { color: "#FF3333", width: 2 },
        },
      ];
    }
  };
  const plotData = useMemo(() => getPlotData(), [results, useClusters, graphType]);
  
  return (
    <div className="min-h-screen bg-dark text-white p-4">
      <h1 className="text-center mb-4">🔆 Análisis de Regresión Solar</h1>

      <div className="text-center mb-3">
        <ButtonGroup>
          {["lineal", "exponencial", "polinomico", "potencial"].map((type) => (
            <Button
              key={type}
              variant={fitType === type ? "primary" : "secondary"}
              onClick={() => setFitType(type)}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </Button>
          ))}
        </ButtonGroup>
      </div>

      <div className="text-center mb-3">
        <Button 
          variant="success" 
          onClick={findBestRegression}
          disabled={graphType === "generacion"}
        >
          Calcular mejor regresión
        </Button>
      </div>

      {results?.overall && !useClusters && (
        <div className="text-center mt-3">
          <h5>
            R² ajustado:{" "}
            <span className="badge" style={getR2Color(results.overall.adjustedR2)}>
              {formatR2(results.overall.adjustedR2)}
            </span>
          </h5>
          <h5 className="mt-2">
            RMSE:{" "}
            <span className="badge bg-info">
              {results.overall.rmse.toFixed(4)}
            </span>
          </h5>
        </div>
      )}
      {results?.clusters && useClusters && (
        <div className="text-center mt-3">
          <h5>Resultados por Cluster:</h5>
          <div style={{ maxHeight: "300px", overflowY: "auto", marginTop: "10px" }}>
            {Object.values(results.clusters).map((clusterResult) => (
              <div key={clusterResult.cluster.key} style={{ marginBottom: "15px" }}>
                <p>
                  <strong>{clusterResult.cluster.label}</strong> ({clusterResult.cluster.data.length} puntos)
                </p>
                <span className="badge" style={getR2Color(clusterResult.adjustedR2)}>
                  R² ajustado: {formatR2(clusterResult.adjustedR2)}
                </span>
              </div>
            ))}
          </div>
          {results.globalRMSE !== undefined && (
            <div style={{ marginTop: "15px" }}>
              <p>
                <strong>RMSE Global (Con Clusters):</strong>{" "}
                <span className="badge bg-warning text-dark">
                  {results.globalRMSE.toFixed(4)}
                </span>
              </p>
            </div>
          )}
        </div>
      )}

      <div className="d-flex justify-content-center align-items-center mb-4 form-switch">
        <input
          className="form-check-input d-inline me-2"
          type="checkbox"
          id="clusters"
          checked={useClusters}
          onChange={(e) => setUseClusters(e.target.checked)}
        />
        <label className="form-check-label" htmlFor="clusters">
          {useClusters ? "Clusters activados" : "Clusters desactivados"}
        </label>
      </div>

      {useClusters && (
        <div className="text-center mb-4">
          <ButtonGroup>
            {["clima", "temperatura", "inclinacion"].map((type) => (
              <Button
                key={type}
                variant={clusterType === type ? "info" : "secondary"}
                onClick={() => setClusterType(type)}
              >
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </Button>
            ))}
          </ButtonGroup>
        </div>
      )}

      <div className="text-center mb-4">
        <ButtonGroup>
          {["potencia", "generacion"].map((type) => (
            <Button
              key={type}
              variant={graphType === type ? "success" : "secondary"}
              onClick={() => setGraphType(type)}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </Button>
          ))}
        </ButtonGroup>
      </div>

      {/* === GRÁFICO PLOTLY === */}
      <Plot
        data={plotData}
        layout={{
          paper_bgcolor: "#222",
          plot_bgcolor: "#222",
          font: { color: "#fff" },
          xaxis: { title: { text: results?.xLabel || results?.overall?.xLabel || "X", font: { size: 18 } } },
          yaxis: { title: { text: results?.yLabel || results?.overall?.yLabel || "Y", font: { size: 18 } } },
          legend: { orientation: "h", y: -0.2 },
          margin: { t: 40, l: 60, r: 30, b: 60 },
          height: 500,
        }}
        config={{ responsive: true, displaylogo: false }}
        style={{ width: "100%", height: "500px" }}
      />
      {bestFit && (
        <div className="mt-4 text-center">
          <h4>🏆 Análisis del Mejor Modelo</h4>
          
          {/* Tabla de comparación de R² ajustado */}
          <div className="mt-4">
            <h5>Comparación de R² Ajustado (Sin Clusters)</h5>
            <table className="table table-dark table-striped mx-auto" style={{ maxWidth: "500px" }}>
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th>R² Ajustado</th>
                </tr>
              </thead>
              <tbody>
                {bestFit.comparisonTable.map((row) => (
                  <tr key={row.type}>
                    <td>{row.type.charAt(0).toUpperCase() + row.type.slice(1)}</td>
                    <td>
                      <span className="badge" style={getR2Color(row.adjustedR2)}>
                        {row.adjustedR2.toFixed(4)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Comparación RMSE */}
          <div className="mt-4">
            <h5>Comparación RMSE</h5>
            <table className="table table-dark table-striped mx-auto" style={{ maxWidth: "600px" }}>
              <thead>
                <tr>
                  <th>Configuración</th>
                  <th>RMSE</th>
                  <th>Proporción</th>
                </tr>
              </thead>
              <tbody>
                {bestFit.rmseComparisonTable.map((row, idx) => (
                  <tr key={idx} style={{
                    backgroundColor: row.type === bestFit.bestConfiguration.type ? "#2a4a2a" : undefined
                  }}>
                    <td><strong>{row.type}</strong></td>
                    <td>
                      <span className="badge bg-info">{row.rmse.toFixed(4)}</span>
                    </td>
                    <td>
                      {row.proportion === 1.0 ? (
                        <span>—</span>
                      ) : (
                        <span style={{
                          color: row.proportion >= 0.9 && row.proportion <= 1.1 ? "#ffc107" : undefined
                        }}>
                          {row.proportion.toFixed(3)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3">
              <strong>Mejor Configuración:</strong>{" "}
              <span className="badge bg-success">
                {bestFit.bestConfiguration.type.toUpperCase()}
              </span>
            </p>
          </div>

          {/* Mejor modelo seleccionado */}
          <div className="mt-4 p-3" style={{ backgroundColor: "#1a1a1a", borderRadius: "8px" }}>
            <h5>Modelo Seleccionado: {bestFit.type.toUpperCase()}</h5>
            <p>
              <strong>R² Ajustado:</strong> {formatR2(bestFit.adjustedR2)}
            </p>
            <p>
              <strong>RMSE (Sin Clusters):</strong> {bestFit.rmseWithoutClusters.toFixed(4)}
            </p>
            
            {/* Ecuación */}
            <p className="mt-3">
              <strong>Función:</strong>
              <br />
              {bestFit.type === "lineal"
                ? `y = ${bestFit.coefficients[0].toFixed(4)}·x + ${bestFit.coefficients[1].toFixed(4)}`
                : bestFit.type === "exponencial"
                ? `y = ${bestFit.coefficients[0].toFixed(4)}·e^(${bestFit.coefficients[1].toFixed(4)}·x)`
                : bestFit.type === "potencial"
                ? `y = ${bestFit.coefficients[0].toFixed(4)}·x^(${bestFit.coefficients[1].toFixed(4)})`
                : `y = ${bestFit.coefficients[0].toFixed(4)} + ${bestFit.coefficients[1].toFixed(4)}·x + ${bestFit.coefficients[2].toFixed(6)}·x²`}
            </p>

            {/* Coeficientes */}
            <p className="mt-2">
              <strong>Coeficientes:</strong>
              <br />
              {bestFit.type === "lineal"
                ? `a = ${bestFit.coefficients[0].toFixed(6)}, b = ${bestFit.coefficients[1].toFixed(6)}`
                : bestFit.type === "exponencial"
                ? `a = ${bestFit.coefficients[0].toFixed(6)}, b = ${bestFit.coefficients[1].toFixed(6)}`
                : bestFit.type === "potencial"
                ? `a = ${bestFit.coefficients[0].toFixed(6)}, b = ${bestFit.coefficients[1].toFixed(6)}`
                : `a = ${bestFit.coefficients[0].toFixed(6)}, b = ${bestFit.coefficients[1].toFixed(6)}, c = ${bestFit.coefficients[2].toFixed(6)}`}
            </p>
          </div>
        </div>
      )}

      {/* Coeficientes del ajuste actual */}
      {results && !bestFit && (
        <div className="mt-4 p-3" style={{ backgroundColor: "#1a1a1a", borderRadius: "8px" }}>
          <h5>Coeficientes del Ajuste Actual ({fitType.toUpperCase()})</h5>
          
          {!useClusters && results.overall && (
            <div className="mt-3">
              <p>
                <strong>Función:</strong>
                <br />
                {fitType === "lineal"
                  ? `y = ${results.overall.coefficients[0].toFixed(4)}·x + ${results.overall.coefficients[1].toFixed(4)}`
                  : fitType === "exponencial"
                  ? `y = ${results.overall.coefficients[0].toFixed(4)}·e^(${results.overall.coefficients[1].toFixed(4)}·x)`
                  : fitType === "potencial"
                  ? `y = ${results.overall.coefficients[0].toFixed(4)}·x^(${results.overall.coefficients[1].toFixed(4)})`
                  : `y = ${results.overall.coefficients[0].toFixed(4)} + ${results.overall.coefficients[1].toFixed(4)}·x + ${results.overall.coefficients[2].toFixed(6)}·x²`}
              </p>
              <p>
                <strong>Coeficientes:</strong>
                <br />
                {fitType === "lineal"
                  ? `a = ${results.overall.coefficients[0].toFixed(6)}, b = ${results.overall.coefficients[1].toFixed(6)}`
                  : fitType === "exponencial"
                  ? `a = ${results.overall.coefficients[0].toFixed(6)}, b = ${results.overall.coefficients[1].toFixed(6)}`
                  : fitType === "potencial"
                  ? `a = ${results.overall.coefficients[0].toFixed(6)}, b = ${results.overall.coefficients[1].toFixed(6)}`
                  : `a = ${results.overall.coefficients[0].toFixed(6)}, b = ${results.overall.coefficients[1].toFixed(6)}, c = ${results.overall.coefficients[2].toFixed(6)}`}
              </p>
            </div>
          )}

          {useClusters && results.clusters && (
            <div className="mt-3">
              {Object.values(results.clusters).map((clusterResult) => (
                <div key={clusterResult.cluster.key} className="mb-4 p-2" style={{ backgroundColor: "#2a2a2a", borderRadius: "5px" }}>
                  <p><strong>{clusterResult.cluster.label}</strong></p>
                  <p>
                    {fitType === "lineal"
                      ? `y = ${clusterResult.coefficients[0].toFixed(4)}·x + ${clusterResult.coefficients[1].toFixed(4)}`
                      : fitType === "exponencial"
                      ? `y = ${clusterResult.coefficients[0].toFixed(4)}·e^(${clusterResult.coefficients[1].toFixed(4)}·x)`
                      : fitType === "potencial"
                      ? `y = ${clusterResult.coefficients[0].toFixed(4)}·x^(${clusterResult.coefficients[1].toFixed(4)})`
                      : `y = ${clusterResult.coefficients[0].toFixed(4)} + ${clusterResult.coefficients[1].toFixed(4)}·x + ${clusterResult.coefficients[2].toFixed(6)}·x²`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Resolucion;
