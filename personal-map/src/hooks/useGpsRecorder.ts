"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  filterRecordedPoint,
  type RecordedPoint,
} from "@/lib/activity-points";

export type RecorderState = "idle" | "starting" | "recording" | "stopping" | "error";

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function useGpsRecorder(activityId: string | null) {
  const [state, setState] = useState<RecorderState>("idle");
  const [points, setPoints] = useState<RecordedPoint[]>([]);
  const [distanceM, setDistanceM] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const bufferRef = useRef<RecordedPoint[]>([]);
  const lastAcceptedRef = useRef<RecordedPoint | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const activityIdRef = useRef(activityId);
  activityIdRef.current = activityId;

  const flush = useCallback(async () => {
    const id = activityIdRef.current;
    if (!id || bufferRef.current.length === 0) return;
    const batch = bufferRef.current.splice(0);
    await fetch(`/api/activities/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ points: batch }),
    });
  }, []);

  const startWatch = useCallback(() => {
    if (!navigator.geolocation) {
      setError("Geolocalizzazione non supportata");
      setState("error");
      return;
    }

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const candidate: RecordedPoint = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          eleM: pos.coords.altitude,
          ts: pos.timestamp,
          accuracyM: pos.coords.accuracy,
        };
        if (!filterRecordedPoint(candidate, lastAcceptedRef.current)) return;

        const last = lastAcceptedRef.current;
        if (last) {
          setDistanceM((d) => d + haversineM(last.lat, last.lng, candidate.lat, candidate.lng));
        }
        lastAcceptedRef.current = candidate;
        bufferRef.current.push(candidate);
        setPoints((prev) => [...prev, candidate]);
      },
      (err) => {
        setError(err.message);
        setState("error");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
    watchIdRef.current = id;
    setState("recording");
  }, []);

  const stopWatch = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (state !== "recording") return;
    const t = setInterval(() => void flush(), 10000);
    return () => clearInterval(t);
  }, [state, flush]);

  useEffect(() => {
    const onUnload = () => {
      if (bufferRef.current.length && activityIdRef.current) {
        const blob = new Blob(
          [JSON.stringify({ points: bufferRef.current })],
          { type: "application/json" }
        );
        navigator.sendBeacon(
          `/api/activities/${encodeURIComponent(activityIdRef.current)}`,
          blob
        );
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  const start = useCallback(async (opts?: { name?: string; activityType?: string }) => {
    setState("starting");
    setError(null);
    setPoints([]);
    setDistanceM(0);
    bufferRef.current = [];
    lastAcceptedRef.current = null;

    const res = await fetch("/api/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(opts ?? {}),
    });
    const data = (await res.json()) as {
      activityId?: string;
      started_at?: number;
      error?: string;
    };
    if (!res.ok) throw new Error(data.error ?? "Avvio fallito");

    setStartedAt(data.started_at ?? Date.now());
    activityIdRef.current = data.activityId ?? null;
    startWatch();
    return data.activityId!;
  }, [startWatch]);

  const stop = useCallback(async () => {
    setState("stopping");
    stopWatch();
    await flush();
    const id = activityIdRef.current;
    if (!id) throw new Error("Nessuna activity attiva");

    const res = await fetch(`/api/activities/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action: "stop" }),
    });
    const data = (await res.json()) as {
      trackId?: string;
      length_km?: number;
      error?: string;
    };
    if (!res.ok) throw new Error(data.error ?? "Stop fallito");
    setState("idle");
    return data;
  }, [flush, stopWatch]);

  const discard = useCallback(async () => {
    stopWatch();
    const id = activityIdRef.current;
    if (id) {
      await fetch(`/api/activities/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "discard" }),
      });
    }
    setState("idle");
    setPoints([]);
  }, [stopWatch]);

  return {
    state,
    points,
    distanceM,
    error,
    startedAt,
    start,
    stop,
    discard,
    activityId: activityIdRef.current,
  };
}
