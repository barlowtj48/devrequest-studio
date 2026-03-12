import * as React from "react";
import "./App.css";
import { responseUpdated } from "./features/response/responseSlice";
import { requestMethodUpdated } from "./features/requestMethod/requestMethodSlice";
import { requestUrlLoaded } from "./features/requestUrl/requestUrlSlice";
import { requestAuthLoaded } from "./features/requestAuth/requestAuthSlice";
import { requestBodyLoaded } from "./features/requestBody/requestBodySlice";
import { requestHeadersLoaded } from "./features/requestHeader/requestHeaderSlice";
import { DevRequest } from "./pages/DevRequest";
import { useAppDispatch } from "./redux/hooks";
import vscode from "./vscode";

const App = () => {
  const dispatch = useAppDispatch();

  React.useEffect(() => {
    // Send ready message to extension
    if (vscode) {
      vscode.postMessage({ type: "webview-ready" });
    }

    window.addEventListener("message", (event) => {
      if (event.data.type === "response") {
        dispatch(responseUpdated(event.data));
      } else if (event.data.type === "load-request") {
        const request = event.data.request;
        dispatch(requestMethodUpdated(request.method));
        dispatch(
          requestUrlLoaded({
            url: request.url,
            queryParams: request.queryParams,
          })
        );
        if (request.headers) {
          dispatch(requestHeadersLoaded(request.headers));
        }
        if (request.body) {
          dispatch(requestBodyLoaded(request.body));
        }
        if (request.auth) {
          dispatch(requestAuthLoaded(request.auth));
        }
      }
    });
  }, [dispatch]);

  return (
    <div className="App">
      <DevRequest />
    </div>
  );
};

export default App;
