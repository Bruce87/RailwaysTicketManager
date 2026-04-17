// Main configuration used by all local line pages.
const LOCAL_LINES = {
    western: { label: "Western Line", source: "Borivali", destination: "Dadar", dataKey: "MUMBAI_WESTERN_TRAINS" },
    central: { label: "Central Line", source: "Thane", destination: "Dadar", dataKey: "MUMBAI_CENTRAL_TRAINS" },
    harbour: { label: "Harbour Line", source: "Goregaon", destination: "CSMT", dataKey: "MUMBAI_HARBOUR_TRAINS" }
};

// Some station names are written differently in the CSV, so we normalise them here.
const STATION_ALIASES = { "Vasai Road": "Vasai", Nallasopara: "Nalasopara", "Vadala Road": "Wadala Road" };
const QR_IMAGE = "Ticket.jpg";
const TICKET_VALIDITY_MS = 60 * 60 * 1000;

// Each ticket area gets its own timer so old countdowns can be cleared safely.
const ticketTimers = new WeakMap();
const $ = (id) => document.getElementById(id);

function setFeedback(element, message, tone = "") {
    element.className = `planner-feedback${tone ? ` tone-${tone}` : ""}`; 
    element.textContent = message;
}

function setSelectOptions(select, values, placeholder) {
    select.innerHTML = `<option value="">${placeholder}</option>${values
        .map((value) => `<option value="${value}">${value}</option>`)
        .join("")}`;
}

function minutes(time) {
    const [hours, mins] = time.split(":").map(Number);
    return hours * 60 + mins;
}

function nowTime() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function formatDateTime(date = new Date()) {
    return new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    }).format(date);
}

function bookingId(prefix) {
    return `${prefix}-${String(Date.now()).slice(-6)}`;
}

// Converts station names into one consistent format before route matching starts.
function normaliseTrains(trains) {
    return trains.map((train) => ({
        ...train,
        stops: train.stops.map((stop) => ({
            ...stop,
            station: STATION_ALIASES[stop.station] || stop.station
        }))
    }));
}

// We use the longest route as a practical station list for the dropdown.
function stationList(trains) {
    const longest = trains.reduce((best, current) => (current.stops.length > best.stops.length ? current : best), trains[0]);
    return longest.stops.map((stop) => stop.station);
}

// Direction is decided from the order of source and destination in the station list.
function direction(source, destination, stations, forward = "Down", reverse = "Up") {
    return stations.indexOf(source) < stations.indexOf(destination) ? forward : reverse;
}

function renderClasses(container, isAc) {
    const options = ["Second Class", "First Class", ...(isAc ? ["AC"] : [])];
    container.innerHTML = options
        .map(
            (option, index) => `
            <label class="class-choice">
                <input type="radio" name="travel-class" value="${option}" ${index === 0 ? "checked" : ""}>
                <span>${option}</span>
            </label>
        `
        )
        .join("");
}
// Resets the class options area to a default disabled state when a new train is searched or no train is selected.
function clearClasses(container) {
    container.innerHTML = `
        <label class="class-choice is-disabled">
            <input type="radio" disabled>
            <span>Select a train first</span>
        </label>
    `;
}

function clearTicketValidity(container) {
    const timer = ticketTimers.get(container);
    if (timer) {
        clearInterval(timer);
        ticketTimers.delete(container);
    }
}
// Converts remaining milliseconds into a countdown format for display on the ticket.
function formatCountdown(remainingMs) {
    const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
}

// Starts the live countdown shown on every generated ticket.
function startTicketValidity(container) {
    clearTicketValidity(container);

    const validity = container.querySelector("[data-ticket-validity]");
    if (!validity) return;

    const expiresAt = Number(validity.dataset.expiryTime);
    if (!expiresAt) return;

    const updateValidity = () => {
        const remaining = expiresAt - Date.now();
        if (remaining <= 0) {
            validity.textContent = "Ticket expired";
            validity.classList.add("is-expired");
            clearTicketValidity(container);
            return;
        }

        validity.textContent = `Valid for ${formatCountdown(remaining)}`;
        validity.classList.remove("is-expired");
    };

    updateValidity();
    ticketTimers.set(container, setInterval(updateValidity, 1000));
}

// Builds the HTML card used for both local tickets and metro tickets.
function ticketCard({ tag, title, badge, fields, alt, note, expiresAt }) {
    return `
        <article class="ticket-card">
            <div class="ticket-top">
                <div>
                    <p class="card-tag">${tag}</p>
                    <h3>${title}</h3>
                </div>
                <span class="ticket-class">${badge}</span>
            </div>
            <p class="ticket-validity" data-ticket-validity data-expiry-time="${expiresAt}">Valid for 01:00:00</p>
            <div class="ticket-grid">
                ${fields
                    .map(
                        ({ label, value }) => `
                        <div>
                            <span class="ticket-label">${label}</span>
                            <strong>${value}</strong>
                        </div>
                    `
                    )
                    .join("")}
            </div>
            <div class="ticket-qr-block">
                <img src="${QR_IMAGE}" alt="${alt}">
                <p>${note}</p>
            </div>
        </article>
    `;
}
// Renders the list of matching trains as clickable cards. Highlights the selected train if applicable.
function renderResults(container, results, selectedId = "") {
    if (!results.length) {
        container.innerHTML = `
            <article class="result-card">
                <h3>No trains found</h3>
                <p>Try another route or time.</p>
            </article>
        `;
        return;
    }

    container.innerHTML = results
        .map(
            (train) => `
            <article class="result-card ${selectedId === train.resultId ? "is-selected" : ""}">
                <div class="result-header">
                    <div>
                        <h3>${train.trainName}</h3>
                        <p class="result-route">${train.source} to ${train.destination}</p>
                    </div>
                    <span class="result-time">${train.departureTime}</span>
                </div>
                <div class="result-meta">
                    <span>Arrival ${train.arrivalTime}</span>
                    <span>Platform ${train.platform}</span>
                    <span>${train.trainType}</span>
                </div>
                <div class="result-actions">
                    <button type="button" class="button button-secondary" data-train-id="${train.resultId}">
                        ${selectedId === train.resultId ? "Selected" : "Select"}
                    </button>
                </div>
            </article>
        `
        )
        .join("");
}

// Filters the full timetable down to trains that actually cover the selected route and time.
function matchingTrains(trains, source, destination, after, stations) {
    return trains
        .filter((train) => train.direction === direction(source, destination, stations))
        .map((train) => {
            const from = train.stops.find((stop) => stop.station === source);
            const to = train.stops.find((stop) => stop.station === destination);
            if (!from || !to || from.order >= to.order) return null;

            return {
                resultId: `${train.trainNo}-${source}-${destination}`,
                trainNo: train.trainNo,
                trainName: train.trainName,
                trainType: train.trainType,
                acLocal: train.acLocal,
                source,
                destination,
                departureTime: from.time,
                arrivalTime: to.time,
                platform: from.platform,
                departureMinutes: minutes(from.time)
            };
        })
        .filter(Boolean)
        .sort((first, second) => first.departureMinutes - second.departureMinutes)
        .filter((train, index, list) => (list.some((item) => item.departureMinutes >= minutes(after)) ? train.departureMinutes >= minutes(after) : true))
        .slice(0, 3);
}

// Handles local train search, train selection, and local ticket generation.
async function initLocalPlanner() {
    const lineKey = document.body.dataset.line;
    const planner = $("journey-planner");
    const config = LOCAL_LINES[lineKey];
    if (!planner || !config) return;

    const ui = {
        source: $("source-station"),
        destination: $("destination-station"),
        time: $("travel-after"),
        feedback: $("planner-feedback"),
        results: $("planner-results"),
        summary: $("selected-train-summary"),
        swap: $("swap-stations"),
        ticketForm: $("ticket-form"),
        classOptions: $("class-options"),
        ticketFeedback: $("ticket-feedback"),
        ticketOutput: $("ticket-output"),
        travellers: $("traveller-count")
    };

    let loadedTrains = [];

    // First try the Node.js API. If that fails, use the backup data loaded in train-data.js.
    try {
        const response = await fetch(`/api/local-lines/${lineKey}`);
        if (!response.ok) {
            throw new Error("API request failed");
        }
        loadedTrains = (await response.json()).trains || [];
    } catch (error) {
        loadedTrains = window[config.dataKey] || [];
    }

    if (!loadedTrains.length) {
        setFeedback(ui.feedback, `Could not load ${config.label}.`, "warning");
        return;
    }

    const trains = normaliseTrains(loadedTrains);
    const stations = stationList(trains);
    const state = { selected: null, results: [] };

    setSelectOptions(ui.source, stations, "Select source station");
    setSelectOptions(ui.destination, stations, "Select destination station");
    ui.source.value = config.source;
    ui.destination.value = config.destination;
    ui.time.value = nowTime();
    ui.summary.textContent = "No train selected.";
    clearClasses(ui.classOptions);
    setFeedback(ui.feedback, `Search the ${config.label} timetable.`, "neutral");
    setFeedback(ui.ticketFeedback, "Select a train to continue.", "neutral");

    ui.swap.addEventListener("click", () => {
        [ui.source.value, ui.destination.value] = [ui.destination.value, ui.source.value];
    });

    planner.addEventListener("submit", (event) => {
        event.preventDefault();
        const source = ui.source.value;
        const destination = ui.destination.value;

        if (!source || !destination || !ui.time.value) {
            setFeedback(ui.feedback, "Choose source, destination, and time.", "warning");
            return;
        }

        if (source === destination) {
            setFeedback(ui.feedback, "Source and destination cannot be the same.", "warning");
            return;
        }

        // Reset previous selection before showing fresh train results.
        state.selected = null;
        clearTicketValidity(ui.ticketOutput);
        ui.ticketOutput.innerHTML = "";
        ui.summary.textContent = "No train selected.";
        clearClasses(ui.classOptions);
        state.results = matchingTrains(trains, source, destination, ui.time.value, stations);
        renderResults(ui.results, state.results);

        setFeedback(
            ui.feedback,
            state.results.length ? `Showing trains from ${source} to ${destination}.` : `No train found from ${source} to ${destination}.`,
            state.results.length ? "success" : "warning"
        );
    });

    // Clicking Select stores the chosen train and enables the class options.
    ui.results.addEventListener("click", (event) => {
        const button = event.target.closest("[data-train-id]");
        if (!button) return;

        state.selected = state.results.find((train) => train.resultId === button.dataset.trainId) || null;
        if (!state.selected) return;

        ui.summary.textContent = `${state.selected.trainName} | ${state.selected.departureTime} | Platform ${state.selected.platform}`;
        renderClasses(ui.classOptions, state.selected.acLocal === "Yes");
        renderResults(ui.results, state.results, state.selected.resultId);
        setFeedback(ui.ticketFeedback, "Choose class and generate the ticket.", "success");
    });

    ui.ticketForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const travelClass = ui.ticketForm.querySelector('input[name="travel-class"]:checked');
        const travellers = Number(ui.travellers.value);

        if (!state.selected) {
            setFeedback(ui.ticketFeedback, "Select a train first.", "warning");
            return;
        }

        if (!travelClass) {
            setFeedback(ui.ticketFeedback, "Choose a class.", "warning");
            return;
        }

        if (!Number.isInteger(travellers) || travellers < 1 || travellers > 6) {
            setFeedback(ui.ticketFeedback, "Traveler count must be between 1 and 6.", "warning");
            return;
        }

        const issuedOn = new Date();
        const expiresOn = new Date(issuedOn.getTime() + TICKET_VALIDITY_MS);

        ui.ticketOutput.innerHTML = ticketCard({
            tag: `${config.label} Ticket`,
            title: `${state.selected.source} to ${state.selected.destination}`,
            badge: travelClass.value,
            fields: [
                { label: "Train", value: state.selected.trainName },
                { label: "Train No", value: state.selected.trainNo },
                { label: "Departure", value: state.selected.departureTime },
                { label: "Arrival", value: state.selected.arrivalTime },
                { label: "Platform", value: state.selected.platform },
                { label: "Travelers", value: travellers },
                { label: "Issued At", value: formatDateTime(issuedOn) },
                { label: "Valid Until", value: formatDateTime(expiresOn) },
                { label: "Booking ID", value: bookingId(lineKey.slice(0, 3).toUpperCase()) }
            ],
            alt: "Ticket QR code for station scanning",
            note: "Show this QR code at the station gate.",
            expiresAt: expiresOn.getTime()
        });

        startTicketValidity(ui.ticketOutput);
        setFeedback(ui.ticketFeedback, "Ticket generated successfully.", "success");
    });
}

// Handles metro station selection and metro ticket generation.
function initMetroBooking() {
    const lineKey = document.body.dataset.metroLine;
    const form = $("metro-booking-form");
    const line = window.MUMBAI_METRO_LINES?.[lineKey];
    if (!form || !line) return;

    const ui = {
        source: $("metro-source-station"),
        destination: $("metro-destination-station"),
        travellers: $("metro-traveller-count"),
        feedback: $("metro-ticket-feedback"),
        output: $("metro-ticket-output")
    };

    setSelectOptions(ui.source, line.stations, "Select source station");
    setSelectOptions(ui.destination, line.stations, "Select destination station");
    ui.source.value = line.stations[0];
    ui.destination.value = line.stations[line.stations.length - 1];
    setFeedback(ui.feedback, `Choose stations on ${line.label}.`, "neutral");

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        const source = ui.source.value;
        const destination = ui.destination.value;
        const travellers = Number(ui.travellers.value);
        const ticketType = form.querySelector('input[name="metro-ticket-type"]:checked');

        if (!source || !destination || source === destination) {
            setFeedback(ui.feedback, "Choose valid source and destination stations.", "warning");
            return;
        }

        if (!ticketType) {
            setFeedback(ui.feedback, "Choose a ticket type.", "warning");
            return;
        }

        if (!Number.isInteger(travellers) || travellers < 1 || travellers > 6) {
            setFeedback(ui.feedback, "Traveler count must be between 1 and 6.", "warning");
            return;
        }

        const issuedOn = new Date();
        const expiresOn = new Date(issuedOn.getTime() + TICKET_VALIDITY_MS);

        ui.output.innerHTML = ticketCard({
            tag: `${line.label} Ticket`,
            title: `${source} to ${destination}`,
            badge: ticketType.value,
            fields: [
                { label: "Line", value: line.label },
                { label: "Route", value: line.route },
                { label: "Direction", value: direction(source, destination, line.stations, "Outbound", "Inbound") },
                { label: "Travelers", value: travellers },
                { label: "Issued At", value: formatDateTime(issuedOn) },
                { label: "Valid Until", value: formatDateTime(expiresOn) },
                { label: "Booking ID", value: bookingId(line.code) }
            ],
            alt: "Metro ticket QR code",
            note: "Show this QR code at the metro gate.",
            expiresAt: expiresOn.getTime()
        });

        startTicketValidity(ui.output);
        setFeedback(ui.feedback, "Metro ticket generated successfully.", "success");
    });
}

initLocalPlanner();
initMetroBooking();
