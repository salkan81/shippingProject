import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { LatLngTuple, LatLngBounds, icon } from "leaflet";
import { useMap } from "react-leaflet";
import { useRouteContext } from "~/app/context/RouteContext";
import "leaflet/dist/leaflet.css";
import "leaflet.geodesic";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";

import greenDot from "/public/leaflet/green-dot.png";
import redDot from "/public/leaflet/red-dot.png";
import blueDot from "/public/leaflet/blue-dot.png";

import ForecastConeLayer from "../CycloneLayer/ForecastCone";
import ObservedTrackLayer from "../CycloneLayer/ObservedTrack";
import ForecastTrackLayer from "../CycloneLayer/ForecastTrack";

import { checkIntersectionBetweenLineAndPolygon } from "~/utils/CheckIntersectionBetweenLineAndPolygon";
import { checkIntersectionBetweenLines } from "~/utils/CheckInterSectionBetweenLines";

const MapContainer = dynamic(() => import("react-leaflet").then((mod) => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import("react-leaflet").then((mod) => mod.TileLayer), { ssr: false });
const Marker = dynamic(() => import("react-leaflet").then((mod) => mod.Marker), { ssr: false });
const Popup = dynamic(() => import("react-leaflet").then((mod) => mod.Popup), { ssr: false });
const Tooltip = dynamic(() => import("react-leaflet").then((mod) => mod.Tooltip), { ssr: false });

interface GeodesicPolylineProps {
  positions: LatLngTuple[];
}

interface MapProps {
  showForecastConeLayer: boolean;
  showObservedTrackLayer: boolean;
  showForecastTrackLayer: boolean;
}

const GeodesicPolyline: React.FC<GeodesicPolylineProps> = ({ positions }) => {
  const map = useMap();

  useEffect(() => {
    if (positions.length > 1) {
      const L = require("leaflet") as typeof import("leaflet");

      const geodesicPolyline = L.geodesic(positions, {
        weight: 2,
        color: "blue",
        wrap: false,
      }).addTo(map);

      return () => {
        map.removeLayer(geodesicPolyline);
      };
    }
  }, [positions, map]);

  return null;
};

const SetViewOnRouteData: React.FC<{ center: LatLngTuple | null }> = ({ center }) => {
  const map = useMap();

  useEffect(() => {
    if (center && !isNaN(center[0]) && !isNaN(center[1])) {
      map.setView(center, 3);
    } else {
      console.warn("Invalid or missing center coordinates:", center);
    }
  }, [center, map]);

  return null;
};

const Map: React.FC<MapProps> = ({ showForecastConeLayer, showObservedTrackLayer, showForecastTrackLayer }) => {
  const { globalRouteData } = useRouteContext();
  const [adjustedCoordinates, setAdjustedCoordinates] = useState<LatLngTuple[]>([]);
  const [center, setCenter] = useState<LatLngTuple | null>(null);
  const [intersectionPoint, setIntersectionPoint] = useState<LatLngTuple | null>(null);
  const [isOriginPopupOpen, setIsOriginPopupOpen] = useState(false);
  const [isDestinationPopupOpen, setIsDestinationPopupOpen] = useState(false);
  const [forecastConeData, setForecastConeData] = useState<any>(null);
  const [observedTrackData, setObservedTrackData] = useState<any>(null);

  const FirstIcon = icon({
    iconUrl: greenDot.src,
    iconSize: [25, 25],
  });

  const LastIcon = icon({
    iconUrl: redDot.src,
    iconSize: [25, 25],
  });

  const MiddleIcon = icon({
    iconUrl: blueDot.src,
    iconSize: [10, 10],
  });

  useEffect(() => {
    if (globalRouteData && globalRouteData.length > 0) {
      const rawCoordinates: LatLngTuple[] = [];
      const adjustedCoordinates: LatLngTuple[] = [];

      globalRouteData.forEach((point) => {
        const lat = parseFloat(point.latitude);
        const lon = parseFloat(point.longitude);
        rawCoordinates.push([lat, lon]);
        const adjustedCoords = handleDateLineCrossing(adjustedCoordinates[adjustedCoordinates.length - 1], [lat, lon]);
        adjustedCoordinates.push(adjustedCoords);
      });

      setAdjustedCoordinates(adjustedCoordinates);
      setCenter(calculateMeanLatLon(adjustedCoordinates));
    }
  }, [globalRouteData]);

  useEffect(() => {
    const checkIntersectionsWithFeatures = (
      features: any[],
      adjustedCoordinates: LatLngTuple[],
      checkFunction: (adjustedCoordinates: LatLngTuple[], polygon: [number, number][][]) => LatLngTuple | null
    ): LatLngTuple | null => {
      for (const feature of features) {
        const polygon = feature?.geometry?.coordinates as [number, number][][];
        const intersection = checkFunction(adjustedCoordinates, polygon);
        if (intersection) {
          return intersection;
        }
      }
      return null;
    };

    const handleConeDataIntersection = (adjustedCoordinates: LatLngTuple[]) => {
      const originalFeatures = forecastConeData?.original?.features || [];
      const minus360Features = forecastConeData?.minus360?.features || [];
      const plus360Features = forecastConeData?.plus360?.features || [];

      const intersectionOriginal = checkIntersectionsWithFeatures(
        originalFeatures,
        adjustedCoordinates,
        checkIntersectionBetweenLineAndPolygon
      );
      const intersectionMinus360 = checkIntersectionsWithFeatures(
        minus360Features,
        adjustedCoordinates,
        checkIntersectionBetweenLineAndPolygon
      );
      const intersectionPlus360 = checkIntersectionsWithFeatures(
        plus360Features,
        adjustedCoordinates,
        checkIntersectionBetweenLineAndPolygon
      );

      return intersectionOriginal || intersectionMinus360 || intersectionPlus360 || null;
    };

    const handleTrackDataIntersection = (adjustedCoordinates: LatLngTuple[]): LatLngTuple | null => {
      const checkIntersectionForTrackGroup = (trackData: any): LatLngTuple | null => {
        for (const feature of trackData.features) {
          const trackCoordinates = feature.geometry.coordinates.map((coord: any) => [coord[1], coord[0]]);
          const intersectionPoint = checkIntersectionBetweenLines(
            adjustedCoordinates as [number, number][],
            trackCoordinates
          );

          if (intersectionPoint) {
            return intersectionPoint;
          }
        }
        return null;
      };

      const intersectionOriginalTrack = checkIntersectionForTrackGroup(observedTrackData.original);
      const intersectionMinus360Track = checkIntersectionForTrackGroup(observedTrackData.minus360);
      const intersectionPlus360Track = checkIntersectionForTrackGroup(observedTrackData.plus360);

      return intersectionOriginalTrack || intersectionMinus360Track || intersectionPlus360Track || null;
    };

    const findAndHandleIntersection = () => {
      if (!adjustedCoordinates.length) return;

      let intersection: LatLngTuple | null = null;

      if (forecastConeData) {
        intersection = handleConeDataIntersection(adjustedCoordinates);
      }

      if (!intersection && observedTrackData) {
        intersection = handleTrackDataIntersection(adjustedCoordinates);
      }

      if (intersection) {
        setIntersectionPoint(intersection);
        Swal.fire({
          title: "Warning",
          text: "Your route intersects with a forecasted or observed area!",
          icon: "warning",
          confirmButtonText: "OK",
          confirmButtonColor: "#3085d6",
        });
      } else {
        setIntersectionPoint(null);
        console.log("No intersection found.");
      }
    };

    findAndHandleIntersection();
  }, [forecastConeData, observedTrackData, adjustedCoordinates]);

  const handleForecastConeDataLoad = useCallback(
    (data: any) => {
      if (JSON.stringify(forecastConeData) !== JSON.stringify(data)) {
        setForecastConeData(data);
      }
    },
    [forecastConeData]
  );

  const handleObservedTrackDataLoad = useCallback(
    (data: any) => {
      if (JSON.stringify(observedTrackData) !== JSON.stringify(data)) {
        setObservedTrackData(data);
      }
    },
    [observedTrackData]
  );

  const handleDateLineCrossing = (prev: LatLngTuple | undefined, current: LatLngTuple): LatLngTuple => {
    if (!prev) return current;

    const prevLon = prev[1];
    const currLon = current[1];
    const lonDifference = Math.abs(currLon - prevLon);

    if (lonDifference > 180) {
      const adjustedLon = currLon > prevLon ? currLon - 360 : currLon + 360;
      return [current[0], adjustedLon];
    }
    return current;
  };

  const calculateMeanLatLon = (coordinates: LatLngTuple[]): LatLngTuple => {
    const totalPoints = coordinates.length;
    const sumLat = coordinates.reduce((sum, coord) => sum + coord[0], 0);
    const sumLon = coordinates.reduce((sum, coord) => sum + coord[1], 0);

    return [sumLat / totalPoints, sumLon / totalPoints];
  };

  const handlePopupOpen = (index: number) => {
    if (index === 0) {
      setIsOriginPopupOpen(true);
    } else if (index === adjustedCoordinates.length - 1) {
      setIsDestinationPopupOpen(true);
    }
  };

  const handlePopupClose = (index: number) => {
    if (index === 0) {
      setIsOriginPopupOpen(false);
    } else if (index === adjustedCoordinates.length - 1) {
      setIsDestinationPopupOpen(false);
    }
  };

  const maxBounds: LatLngBounds = new LatLngBounds([180, -360], [-180, 540]);

  return (
    <MapContainer
      center={[44, 12]}
      zoom={2}
      style={{ height: "100vh", width: "100%" }}
      className="h-screen w-full"
      maxBounds={maxBounds}
      maxBoundsViscosity={1.0}
      minZoom={2}
      maxZoom={18}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      {showForecastConeLayer && <ForecastConeLayer onDataLoad={handleForecastConeDataLoad} />}
      {showObservedTrackLayer && <ObservedTrackLayer onDataLoad={handleObservedTrackDataLoad} />}
      {showForecastTrackLayer && <ForecastTrackLayer />}
      {adjustedCoordinates.map((position, index) => (
        <Marker
          key={index}
          position={position}
          icon={index === 0 ? FirstIcon : index === adjustedCoordinates.length - 1 ? LastIcon : MiddleIcon}
          eventHandlers={{
            popupopen: () => handlePopupOpen(index),
            popupclose: () => handlePopupClose(index),
          }}
        >
          {index === 0 && !isOriginPopupOpen && <Tooltip permanent>{globalRouteData[0].origin}</Tooltip>}
          {index === adjustedCoordinates.length - 1 && !isDestinationPopupOpen && (
            <Tooltip permanent>{globalRouteData[globalRouteData.length - 1].destination}</Tooltip>
          )}

          <Popup>
            <div>
              Point: {index + 1} <br />
              Latitude: {position[0]}, Longitude: {position[1]} <br />
              {index === 0 && (
                <>
                  Origin Port: {globalRouteData[0].origin} <br />
                </>
              )}
              {index === adjustedCoordinates.length - 1 && (
                <>
                  Destination Port: {globalRouteData[globalRouteData.length - 1].destination} <br />
                </>
              )}
              Cumulative Distance:{" "}
              {globalRouteData[index]?.cumulative_dist !== null && globalRouteData[index]?.cumulative_dist !== undefined
                ? globalRouteData[index].cumulative_dist.toString()
                : "N/A"}{" "}
              nm
            </div>
          </Popup>
        </Marker>
      ))}
      {adjustedCoordinates.length > 1 && <GeodesicPolyline positions={adjustedCoordinates} />}
      {intersectionPoint ? (
        <SetViewOnRouteData center={intersectionPoint} />
      ) : (
        center && <SetViewOnRouteData center={center} />
      )}
    </MapContainer>
  );
};

export default Map;
