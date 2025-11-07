import React from "react";
import { useParams, Link } from "react-router-dom";
import TechnicianItinerary from "../components/TechnicianItinerary";

export default function TechnicianItineraryPage() {
  const { id } = useParams();

  return (
    <div className="p-6">
      <Link to="/technicians" className="text-indigo-600 mb-4 inline-block">← Back to technicians</Link>
      <div className="mt-4">
        <TechnicianItinerary techId={id} />
      </div>
    </div>
  );
}
